(ns metabase.query-processor.parameters.values
  "These functions build a map of information about the types and values of the params used in a query. (These functions
  don't parse the query itself, but instead look at the values of `:template-tags` and `:parameters` passed along with
  the query.)

    (query->params-map some-inner-query)
    ;; -> {\"checkin_date\" {:field {:name \"date\", :parent_id nil, :table_id 1375}
                             :param {:type   \"date/range\"
                                     :target [\"dimension\" [\"template-tag\" \"checkin_date\"]]
                                     :value  \"2015-01-01~2016-09-01\"}}}"
  (:require
   [clojure.string :as str]
   [metabase.lib.core :as lib]
   [metabase.lib.metadata :as lib.metadata]
   [metabase.lib.schema :as lib.schema]
   [metabase.lib.schema.common :as lib.schema.common]
   [metabase.lib.schema.id :as lib.schema.id]
   [metabase.lib.schema.metadata :as lib.schema.metadata]
   [metabase.lib.schema.parameter :as lib.schema.parameter]
   [metabase.lib.schema.template-tag :as lib.schema.template-tag]
   [metabase.lib.util :as lib.util]
   [metabase.query-processor.compile :as qp.compile]
   [metabase.query-processor.error-type :as qp.error-type]
   [metabase.query-processor.middleware.limit :as limit]
   [metabase.query-processor.parameters :as params]
   [metabase.query-processor.util.persisted-cache :as qp.persistence]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.log :as log]
   [metabase.util.malli :as mu]
   [metabase.util.malli.registry :as mr]))

(set! *warn-on-reflection* true)

(defmulti ^:private parse-tag
  "Parse a tag by its `:type`, returning an appropriate [[metabase.query-processor.parameters]] map."
  {:arglists '([metadata-providerable tag params])}
  (fn [_metadata-providerable {tag-type :type, :as _tag} _params]
    (keyword tag-type)))

(defmethod parse-tag :default
  [_metadata-providerable
   {tag-type :type, :as tag}
   _params]
  (throw (ex-info (tru "Don''t know how to parse parameter of type {0}" (pr-str tag-type))
                  {:tag tag})))

;; various schemas are used to check that various functions return things in expected formats

;; TAGS in this case are simple params like {{x}} that get replaced with a single value ("ABC" or 1) as opposed to a
;; "FieldFilter" clause like FieldFilters
;;
;; Since 'FieldFilter' are considered their own `:type` (confusingly enough, called `:dimension`), to *actually* store
;; the type of a FieldFilter look at the key `:widget-type`. This applies to things like the default value for a
;; FieldFilter as well.

(mr/def ::single-value
  "Schema for a valid *single* value for a param."
  [:or ::params/field-filter ::params/date number? :string :boolean])

(mr/def ::parsed-param-value
  "Schema for valid param value(s). Params can have one or more values."
  [:maybe
   [:or {:error/message "Valid param value(s)"}
    ::params/no-value
    ::single-value
    [:sequential ::single-value]
    :map]])

(mu/defn- tag-targets
  "Given a template tag, returns a set of `target` structures that can be used to target the tag.
  Potential targets look something like:

     [:dimension [:template-tag {:id <param-id>}]
     [:dimension [:template-tag <param-name>]]     ; for Field Filters

     [:variable  [:template-tag {:id <param-id>}]]
     [:variable  [:template-tag <param-name>]]     ; for other types of params

  Targeting template tags by ID is preferable (as of version 44) but targeting by name is supported for backwards
  compatibility."
  [tag :- ::lib.schema.template-tag/template-tag]
  (let [target-type (case (:type tag)
                      :dimension     :dimension
                      :variable)]
    #{[target-type [:template-tag (:name tag)]]
      [target-type [:template-tag {:id (:id tag)}]]}))

(defn- tag-target-pred
  "Returns a predicate recognizing parameter targets pointing to `tag`."
  [tag]
  (let [targets (tag-targets tag)]
    (fn tag-target? [param-target]
      (and (vector? param-target)
           (> (count param-target) 1)
           (targets (subvec param-target 0 2))
           ;; legacy dimension params come without stage-number, 0 is the default
           (= (get-in param-target [2 :stage-number] 0)
              ;; Currently, we have no multi-stage native queries, so the stage-number is always 0.
              ;; If in the future we introduce such queries, we can specify the stage-number of tags
              ;; and they should match the stage-number of the parameter target.
              (get tag :stage-number 0))))))

(mu/defn- tag-params
  "Return params from the provided `params` list targeting the provided `tag`."
  [tag    :- ::lib.schema.template-tag/template-tag
   params :- [:maybe [:sequential ::lib.schema.parameter/parameter]]]
  (let [tag-target? (tag-target-pred tag)]
    (seq (for [param params
               :when (tag-target? (:target param))]
           param))))

;;; FieldFilter Params (Field Filters) (e.g. WHERE {{x}})

(defn- missing-required-param-exception [param-display-name]
  (ex-info (tru "You''ll need to pick a value for ''{0}'' before this query can run."
                param-display-name)
           {:type qp.error-type/missing-required-parameter}))

(mu/defn- field-ref->field-id :- ::lib.schema.id/field
  [field-ref :- :mbql.clause/field]
  (last field-ref))

(mu/defn- field-filter-value
  "Get parameter value(s) for a Field filter. Returns map if there is a normal single value, or a vector of maps for
  multiple values."
  [tag    :- ::lib.schema.template-tag/template-tag
   params :- [:maybe [:sequential ::lib.schema.parameter/parameter]]]
  (let [matching-params  (tag-params tag params)
        tag-opts         (:options tag)
        normalize-params (fn [params]
                           ;; remove `:target` which is no longer needed after this point
                           ;; and add any tag options that are compatible with the new type
                           (let [params (map (fn [param]
                                               (let [tag-opts (if (and (contains? tag-opts :case-sensitive)
                                                                       (not (contains? #{:string/contains
                                                                                         :string/does-not-contain
                                                                                         :string/ends-with
                                                                                         :string/starts-with}
                                                                                       (:type param))))
                                                                (dissoc tag-opts :case-sensitive)
                                                                tag-opts)]
                                                 (cond-> (dissoc param :target)
                                                   (seq tag-opts)
                                                   (assoc :options tag-opts))))
                                             params)]
                             (if (= (count params) 1)
                               (first params)
                               params)))
        nil-value?        (and (seq matching-params)
                               (every? (fn [param]
                                         (nil? (:value param)))
                                       matching-params))]
    (cond
      ;; if we have matching parameter(s) with at least one actual value, return them.
      (and (seq matching-params) (some :value matching-params))
      (normalize-params (filter :value matching-params))
      ;; If a FieldFilter has value=nil, return a [[params/no-value]]
      ;; so that this filter can be substituted with "1 = 1" regardless of whether or not this tag has default value
      (and (not (:required tag)) nil-value?)
      params/no-value
      ;; When a FieldFilter has value=nil and is required, use the default value or throw an exception
      (and (:required tag) nil-value?)
      (if-let [tag-default (:default tag)]
        (cond-> {:type    (:widget-type tag :dimension) ; widget-type is the actual type of the default value if set
                 :value   tag-default}
          tag-opts (assoc :options tag-opts))
        (throw (missing-required-param-exception (:display-name tag))))
      ;; otherwise, attempt to fall back to the default value specified as part of the template tag.
      (some? (:default tag))
      (cond-> {:type    (:widget-type tag :dimension) ; widget-type is the actual type of the default value if set
               :value   (:default tag)}
        tag-opts (assoc :options tag-opts))
      ;; if that doesn't exist, see if the matching parameters specified default values This can be the case if the
      ;; parameters came from a Dashboard -- Dashboard parameter mappings can specify their own defaults -- but we want
      ;; the defaults specified in the template tag to take precedence if both are specified
      (and (seq matching-params) (every? :default matching-params))
      (normalize-params matching-params)
      ;; otherwise there is no value for this Field filter ("dimension"), throw Exception if this param is required,
      (:required tag)
      (throw (missing-required-param-exception (:display-name tag)))
      ;; otherwise return [[params/no-value]] to signify that this filter can be substituted with "1 = 1"
      :else
      params/no-value)))

(mu/defmethod parse-tag :dimension :- [:maybe ::params/field-filter]
  [metadata-providerable           :- ::lib.schema.metadata/metadata-providerable
   {field-ref :dimension, :as tag} :- ::lib.schema.template-tag/template-tag
   params                          :- [:maybe [:sequential ::lib.schema.parameter/parameter]]]
  (params/field-filter
   {:field (let [field-id (field-ref->field-id field-ref)]
             (or (lib.metadata/field metadata-providerable field-id)
                 (throw (ex-info (tru "Can''t find field with ID: {0}" field-id)
                                 {:field-id field-id, :type qp.error-type/invalid-parameter}))))
    :value (field-filter-value tag params)}))

(mu/defmethod parse-tag :card :- ::params/referenced-card-query
  [metadata-providerable      :- ::lib.schema.metadata/metadata-providerable
   {:keys [card-id], :as tag} :- ::lib.schema.template-tag/template-tag
   _params]
  (when-not card-id
    (throw (ex-info (tru "Invalid :card parameter: missing `:card-id`")
                    {:tag tag, :type qp.error-type/invalid-parameter})))
  (let [card           (lib.metadata/card metadata-providerable card-id)
        persisted-info (when (= (:type card) :model)
                         (:lib/persisted-info card))
        query          (or (:dataset-query card)
                           (throw (ex-info (tru "Card {0} not found." card-id)
                                           {:card-id card-id, :tag tag, :type qp.error-type/invalid-parameter})))]
    (try
      (params/referenced-card-query
       (let [query (assoc query :info {:card-id card-id})]
         (log/tracef "Compiling referenced query for Card %d\n%s" card-id (u/pprint-to-str query))
         (merge {:card-id card-id}
                (or (when (qp.persistence/can-substitute? card persisted-info)
                      {:query (qp.persistence/persisted-info-native-query
                               (u/the-id (lib.metadata/database metadata-providerable))
                               persisted-info)})
                    (qp.compile/compile (lib/query
                                         (lib.metadata/->metadata-provider metadata-providerable)
                                         (limit/disable-max-results query)))))))
      (catch clojure.lang.ExceptionInfo e
        (throw (ex-info
                (tru "The sub-query from referenced question #{0} failed with the following error: {1}"
                     (str card-id) (pr-str (.getMessage e)))
                {:card-query-error? true
                 :card-id           card-id
                 :tag               tag
                 :type              qp.error-type/invalid-parameter}
                e))))))

(mu/defmethod parse-tag :snippet :- ::params/referenced-query-snippet
  [metadata-providerable                      :- ::lib.schema.metadata/metadata-providerable
   {:keys [snippet-name snippet-id], :as tag} :- ::lib.schema.template-tag/template-tag
   _params]
  (let [snippet-id (or snippet-id
                       (throw (ex-info (tru "Unable to resolve Snippet: missing `:snippet-id`")
                                       {:tag tag, :type qp.error-type/invalid-parameter})))
        snippet    (or (lib.metadata/native-query-snippet metadata-providerable snippet-id)
                       (throw (ex-info (tru "Snippet {0} {1} not found." snippet-id (pr-str snippet-name))
                                       {:snippet-id   snippet-id
                                        :snippet-name snippet-name
                                        :tag          tag
                                        :type         qp.error-type/invalid-parameter})))]
    (params/referenced-query-snippet
     {:snippet-id snippet-id
      :content    (:content snippet)})))

(mu/defmethod parse-tag :temporal-unit
  [_metadata-providerable :- ::lib.schema.metadata/metadata-providerable
   {:keys [required] tag-name :name :as tag}
   params]
  (let [matching-param       (when-let [matching-params (not-empty (tag-params tag params))]
                               (when (> (count matching-params) 1)
                                 (throw (ex-info (tru "Error: multiple values specified for parameter; non-Field Filter parameters can only have one value.")
                                                 {:type
                                                  qp.error-type/invalid-parameter
                                                  :template-tag        tag
                                                  :matching-parameters params})))
                               (first matching-params))
        param-value          (:value matching-param)
        nil-value?           (and matching-param
                                  (nil? param-value))
        valid-temporal-units (into #{}
                                   (map name)
                                   (lib/available-temporal-units))]
    (when-not (or (nil? param-value) (valid-temporal-units param-value))
      (throw (ex-info (tru "Error: invalid value specified for temporal-unit parameter.")
                      {:value    param-value
                       :expected valid-temporal-units})))
    (params/temporal-unit
     {:name  tag-name
      :value (or (:value matching-param)
                 (when (and nil-value? (not required))
                   params/no-value)
                 (:default tag)
                 (if required
                   (throw (missing-required-param-exception (:display-name tag)))
                   params/no-value))})))

;;; Non-FieldFilter Params (e.g. WHERE x = {{x}})

(mu/defn- param-value-for-raw-value-tag
  "Get the value that should be used for a raw value (i.e., non-Field filter) template tag from `params`."
  [tag    :- ::lib.schema.template-tag/template-tag
   params :- [:maybe [:sequential ::lib.schema.parameter/parameter]]]
  (let [matching-param (when-let [matching-params (not-empty (tag-params tag params))]
                         ;; double-check and make sure we didn't end up with multiple mappings or something crazy like that.
                         (when (> (count matching-params) 1)
                           (throw (ex-info (tru "Error: multiple values specified for parameter; non-Field Filter parameters can only have one value.")
                                           {:type                qp.error-type/invalid-parameter
                                            :template-tag        tag
                                            :matching-parameters params})))
                         (first matching-params))
        nil-value?       (and matching-param
                              (nil? (:value matching-param)))]
    ;; But if the param is present in `params` and its value is nil, don't use the default.
    ;; If the param is not present in `params` use a default from either the tag or the Dashboard parameter.
    ;; If both the tag and Dashboard parameter specify a default value, prefer the default value from the tag.
    (or (:value matching-param)
        (when (and nil-value? (not (:required tag)))
          params/no-value)
        (:default tag)
        (:default matching-param)
        (if (:required tag)
          (throw (missing-required-param-exception (:display-name tag)))
          params/no-value))))

(defmethod parse-tag :number
  [_metadata-providerable tag params]
  (param-value-for-raw-value-tag tag params))

(defmethod parse-tag :text
  [_metadata-providerable tag params]
  (param-value-for-raw-value-tag tag params))

(defmethod parse-tag :date
  [_metadata-providerable tag params]
  (param-value-for-raw-value-tag tag params))

;;; Parsing Values

(mu/defn- parse-number :- number?
  "Parse a string like `1` or `2.0` into a valid number. Done mostly to keep people from passing in
  things that aren't numbers, like SQL identifiers. When the value is an integer outside the Long range, BigInteger
  is returned."
  [s :- :string]
  (if (re-find #"\." s)
    (parse-double s)
    (or (parse-long s) (biginteger s))))

(mu/defn- value->number :- [:or number? [:sequential {:min 1} number?]]
  "Parse a 'numeric' param value. Normally this returns an integer or floating-point number, but as a somewhat
  undocumented feature it also accepts comma-separated lists of numbers. This was a side-effect of the old parameter
  code that unquestioningly substituted any parameter passed in as a number directly into the SQL. This has long been
  changed for security purposes (avoiding SQL injection), but since users have come to expect comma-separated numeric
  values to work we'll allow that (with validation) and return a vector to be converted to a list in the native query."
  [value]
  (cond
    ;; already parsed
    (number? value)
    value
    ;; newer operators use vectors as their arguments even if there's only one
    (vector? value)
    (u/many-or-one (mapv value->number value))
    ;; if the value is a string, then split it by commas in the string. Usually there should be none.
    ;; Parse each part as a number.
    (string? value)
    (u/many-or-one (mapv parse-number (str/split value #",")))))

(mu/defn- parse-value-for-field-type :- :any
  "Do special parsing for value for a (presumably textual) FieldFilter (`:type` = `:dimension`) param (i.e., attempt
  to parse it as appropriate based on the base type and semantic type of the Field associated with it). These are
  special cases for handling types that do not have an associated parameter type (such as `date` or `number`), such as
  UUID fields."
  [effective-type :- ::lib.schema.common/base-type value]
  (cond
    (isa? effective-type :type/UUID)
    (java.util.UUID/fromString value)

    (isa? effective-type :type/Number)
    (value->number value)

    :else
    value))

(mu/defn- update-filter-for-field-type :- ::parsed-param-value
  "Update a Field Filter with a textual, or sequence of textual, values. The base type and semantic type of the field
  are used to determine what 'semantic' type interpretation is required (e.g. for UUID fields)."
  [{field :field, {value :value} :value, :as field-filter} :- ::params/field-filter]
  (let [effective-type ((some-fn :effective-type :base-type) field)
        new-value (cond
                    (string? value)
                    (parse-value-for-field-type effective-type value)

                    (and (sequential? value)
                         (every? string? value))
                    (mapv (partial parse-value-for-field-type effective-type) value))]
    (when (not= value new-value)
      (log/tracef "update filter for base-type: %s value: %s -> %s"
                  (pr-str effective-type) (pr-str value) (pr-str new-value)))
    (cond-> field-filter
      new-value (assoc-in [:value :value] new-value))))

(mu/defn- parse-value-for-type :- ::parsed-param-value
  "Parse a `value` based on the type chosen for the param, such as `text` or `number`. (Depending on the type of param
  created, `value` here might be a raw value or a map including information about the Field it references as well as a
  value.) For numbers, dates, and the like, this will parse the string appropriately; for `text` parameters, this will
  additionally attempt handle special cases based on the base type of the Field, for example, parsing params for UUID
  base type Fields as UUIDs."
  [param-type :- ::lib.schema.template-tag/type value]
  (cond
    (= value params/no-value)
    value

    (= param-type :number)
    (value->number value)

    (= param-type :date)
    (params/date {:s value})

    ;; Field Filters
    (and (= param-type :dimension)
         (= (get-in value [:value :type]) :number))
    (update-in value [:value :value] value->number)

    (sequential? value)
    (mapv (partial parse-value-for-type param-type) value)

    ;; Field Filters with "special" base types
    (and (= param-type :dimension)
         (get-in value [:field :base-type]))
    (update-filter-for-field-type value)

    :else
    value))

(mu/defn- value-for-tag :- ::parsed-param-value
  "Given a map `tag` (a value in the `:template-tags` dictionary) return the corresponding value from the `params`
   sequence. The `value` is something that can be compiled to SQL via `->replacement-snippet-info`."
  [metadata-providerable :- ::lib.schema.metadata/metadata-providerable
   tag                   :- ::lib.schema.template-tag/template-tag
   params                :- [:maybe [:sequential ::lib.schema.parameter/parameter]]]
  (try
    (parse-value-for-type (:type tag) (parse-tag metadata-providerable tag params))
    (catch Throwable e
      (throw (ex-info (tru "Error determining value for parameter {0}: {1}"
                           (pr-str (:name tag))
                           (ex-message e))
                      {:tag    tag
                       :type   (or (:type (ex-data e)) qp.error-type/invalid-parameter)
                       :params params}
                      e)))))

(mu/defn stage->params-map :- [:map-of ::lib.schema.common/non-blank-string ::parsed-param-value]
  "Extract parameters info from `query`. Return a map of parameter name -> value.

    (stage->params-map query -1)
    ->
    {:checkin_date #t \"2019-09-19T23:30:42.233-07:00\"}"
  ([query]
   (stage->params-map query 0))

  ([query        :- ::lib.schema/query
    stage-number :- :int]
   (let [{tags :template-tags, params :parameters} (lib.util/query-stage query stage-number)]
     (log/tracef "Building params map out of tags\n%s\nand params\n%s\n" (u/pprint-to-str tags) (u/pprint-to-str params))
     (try
       (into {} (for [[k tag] tags
                      :let    [v (value-for-tag query tag params)]]
                  (do
                    (log/tracef "Value for tag %s\n%s\n->\n%s" (pr-str k) (u/pprint-to-str tag) (u/pprint-to-str v))
                    [k v])))
       (catch Throwable e
         (throw (ex-info (tru "Error building query parameter map: {0}" (ex-message e))
                         {:type   (or (:type (ex-data e)) qp.error-type/invalid-parameter)
                          :tags   tags
                          :params params}
                         e)))))))

(mu/defn referenced-card-ids :- [:set ::lib.schema.id/card]
  "Return a set of all Card IDs referenced in the parameters in `params-map`. This should be added to the (inner) query
  under the `:query-permissions/referenced-card-ids` key when doing parameter expansion."
  [params-map :- [:map-of ::lib.schema.common/non-blank-string ::parsed-param-value]]
  (into #{}
        (keep (fn [param]
                (when (params/referenced-card-query? param)
                  (:card-id param))))
        (vals params-map)))
