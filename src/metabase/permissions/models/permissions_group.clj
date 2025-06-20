(ns metabase.permissions.models.permissions-group
  "A `PermissionsGroup` is a group (or role) that can be assigned certain permissions. Users can be members of one or
  more of these groups.

  A few 'magic' groups exist: [[all-users]], which predicably contains All Users; and [[admin]], which contains all
  superusers. These groups are 'magic' in the sense that you cannot add users to them yourself, nor can you delete
  them; they are created automatically. You can, however, set permissions for them.

  See documentation in [[metabase.permissions.models.permissions]] for more information about the Metabase permissions system."
  (:require
   [metabase.db :as mdb]
   [metabase.models.interface :as mi]
   [metabase.models.serialization :as serdes]
   [metabase.permissions.models.data-permissions :as data-perms]
   [metabase.premium-features.core :as premium-features]
   [metabase.settings.core :as setting]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]]
   [methodical.core :as methodical]
   [toucan2.core :as t2]
   [toucan2.tools.hydrate :as t2.hydrate]))

(methodical/defmethod t2/table-name :model/PermissionsGroup [_model] :permissions_group)
(methodical/defmethod t2/model-for-automagic-hydration [:default :permissions_group] [_original-model _k] :model/PermissionsGroup)
(methodical/defmethod t2.hydrate/fk-keys-for-automagic-hydration [:default :permissions_group :default]
  [_original-model _dest-key _hydrating-model]
  [:permissions_group_id])

(doto :model/PermissionsGroup
  (derive :metabase/model)
  (derive :hook/entity-id))

(defmethod serdes/hash-fields :model/PermissionsGroup
  [_user]
  [:name])

;;; -------------------------------------------- Magic Groups Getter Fns ---------------------------------------------

(defn- magic-group [magic-group-type]
  (mdb/memoize-for-application-db
   (fn []
     (u/prog1 (t2/select-one [:model/PermissionsGroup :id :name :magic_group_type] :magic_group_type magic-group-type)
       ;; normally it is impossible to delete the magic [[all-users]] or [[admin]] Groups -- see
       ;; [[check-not-magic-group]]. This assertion is here to catch us if we do something dumb when hacking on
       ;; the MB code -- to make tests fail fast. For that reason it's not i18n'ed.
       (when-not <>
         (throw (ex-info (format "Fatal error: magic Permissions Group '%s' has gone missing." magic-group-type)
                         {:magic-group-type magic-group-type})))))))

(def all-users-magic-group-type
  "The magic-group type of the \"All Users\" magic group."
  "all-internal-users")

(def ^{:arglists '([])} all-users
  "Fetch the `All Users` permissions group"
  (magic-group all-users-magic-group-type))

(def admin-magic-group-type
  "The magic-group type of the \"Administrators\" magic group."
  "admin")

(def ^{:arglists '([])} admin
  "Fetch the `Administrators` permissions group"
  (magic-group admin-magic-group-type))

;;; --------------------------------------------------- Validation ---------------------------------------------------

(defn exists-with-name?
  "Does a `PermissionsGroup` with `group-name` exist in the DB? (case-insensitive)"
  ^Boolean [group-name]
  {:pre [((some-fn keyword? string?) group-name)]}
  (t2/exists? :model/PermissionsGroup
              :%lower.name (u/lower-case-en (name group-name))))

(defn- check-name-not-already-taken
  [group-name]
  (when (exists-with-name? group-name)
    (throw (ex-info (tru "A group with that name already exists.") {:status-code 400}))))

(defn- check-not-magic-group
  "Make sure we're not trying to edit/delete one of the magic groups, or throw an exception."
  [{id :id}]
  {:pre [(integer? id)]}
  (doseq [magic-group [(all-users)
                       (admin)]]
    (when (= id (:id magic-group))
      (throw (ex-info (tru "You cannot edit or delete the ''{0}'' permissions group!" (:name magic-group))
                      {:status-code 400})))))

;;; --------------------------------------------------- Lifecycle ----------------------------------------------------

(t2/define-before-insert :model/PermissionsGroup
  [{group-name :name, :as group}]
  (u/prog1 group
    (check-name-not-already-taken group-name)))

(defn- set-default-permission-values!
  [group]
  (t2/with-transaction [_conn]
    (doseq [db-id (t2/select-pks-vec :model/Database)]
      (data-perms/set-new-group-permissions! group db-id (u/the-id (all-users))))))

(t2/define-after-insert :model/PermissionsGroup
  [group]
  (u/prog1 group
    (set-default-permission-values! group)))

(t2/define-before-delete :model/PermissionsGroup
  [{id :id, :as group}]
  (check-not-magic-group group)
  (setting/set-value-of-type!
   :json :ldap-group-mappings
   (when-let [mappings (setting/get :ldap-group-mappings)]
     (zipmap (keys mappings)
             (for [val (vals mappings)]
               (remove (partial = id) val))))))

(t2/define-before-update :model/PermissionsGroup
  [group]
  (let [changes (t2/changes group)]
    (u/prog1 group
      (when (contains? changes :name)
        ;; Allow backfilling the entity ID for magic groups, but not changing anything else
        (check-not-magic-group group))
      (when-let [group-name (:name changes)]
        (check-name-not-already-taken group-name)))))

;;; ---------------------------------------------------- Util Fns ----------------------------------------------------

(methodical/defmethod t2/batched-hydrate [:model/PermissionsGroup :members]
  "Batch hydration Users for a list of PermissionsGroups"
  [_model k groups]
  (mi/instances-with-hydrated-data
   groups k
   #(group-by :group_id (t2/select :model/User {:select    [:u.id
                                                            ;; user_id is for legacy reasons, we should remove it
                                                            [:u.id :user_id]
                                                            :u.first_name
                                                            :u.last_name
                                                            :u.email
                                                            :pgm.group_id
                                                            [:pgm.id :membership_id]
                                                            (when (premium-features/enable-advanced-permissions?)
                                                              [:pgm.is_group_manager :is_group_manager])]
                                                :from      [[:core_user :u]]
                                                :left-join [[:permissions_group_membership :pgm] [:= :u.id :pgm.user_id]]
                                                :where     [:and
                                                            [:= :u.is_active true]
                                                            [:in :pgm.group_id (map :id groups)]]
                                                :order-by  [[[:lower :u.first_name] :asc]
                                                            [[:lower :u.last_name] :asc]]}))
   :id
   {:default []}))

(defn non-admin-groups
  "Return a set of the IDs of all `PermissionsGroups`, aside from the admin group."
  []
  (t2/select :model/PermissionsGroup :magic_group_type [:not= admin-magic-group-type]))

(defn non-magic-groups
  "Return a set of the IDs of all `PermissionsGroups`, aside from the admin group and the All Users group."
  []
  (t2/select :model/PermissionsGroup {:where [:= :magic_group_type nil]}))
