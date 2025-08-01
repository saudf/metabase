(ns metabase.lib.expression
  (:refer-clojure :exclude [+ - * / case coalesce abs time concat replace float])
  (:require
   [clojure.string :as str]
   [medley.core :as m]
   [metabase.lib.common :as lib.common]
   [metabase.lib.hierarchy :as lib.hierarchy]
   [metabase.lib.metadata :as lib.metadata]
   [metabase.lib.metadata.calculation :as lib.metadata.calculation]
   [metabase.lib.options :as lib.options]
   [metabase.lib.ref :as lib.ref]
   [metabase.lib.schema :as lib.schema]
   [metabase.lib.schema.aggregation :as lib.schema.aggregation]
   [metabase.lib.schema.common :as lib.schema.common]
   [metabase.lib.schema.expression :as lib.schema.expression]
   [metabase.lib.schema.expression.conditional :as lib.schema.expression.conditional]
   [metabase.lib.schema.expression.temporal :as lib.schema.expression.temporal]
   [metabase.lib.schema.metadata :as lib.schema.metadata]
   [metabase.lib.schema.temporal-bucketing :as lib.schema.temporal-bucketing]
   [metabase.lib.temporal-bucket :as lib.temporal-bucket]
   [metabase.lib.util :as lib.util]
   [metabase.lib.util.match :as lib.util.match]
   [metabase.types.core :as types]
   [metabase.util :as u]
   [metabase.util.i18n :as i18n]
   [metabase.util.log :as log]
   [metabase.util.malli :as mu]
   [metabase.util.malli.registry :as mr]
   [metabase.util.number :as u.number]))

(mu/defn column-metadata->expression-ref :- :mbql.clause/expression
  "Given `:metadata/column` column metadata for an expression, construct an `:expression` reference."
  [metadata :- ::lib.schema.metadata/column]
  (let [options (merge
                 {:lib/uuid       (str (random-uuid))
                  :base-type      (:base-type metadata)
                  :effective-type ((some-fn :effective-type :base-type) metadata)}
                 (when-let [unit (:metabase.lib.field/temporal-unit metadata)]
                   {:temporal-unit unit}))]
    [:expression options ((some-fn :lib/expression-name :name) metadata)]))

(mu/defn maybe-resolve-expression :- ::lib.schema.expression/expression
  "Find the expression with `expression-name` in a given stage of a `query`, or nil if it doesn't exist."
  ([query expression-name]
   (maybe-resolve-expression query -1 expression-name))

  ([query           :- ::lib.schema/query
    stage-number    :- :int
    expression-name :- ::lib.schema.common/non-blank-string]
   (let [stage (lib.util/query-stage query stage-number)]
     (m/find-first (comp #{expression-name} lib.util/expression-name)
                   (:expressions stage)))))

(mu/defn resolve-expression :- ::lib.schema.expression/expression
  "Find the expression with `expression-name` in a given stage of a `query`, or throw an Exception if it doesn't
  exist."
  ([query expression-name]
   (resolve-expression query -1 expression-name))

  ([query           :- ::lib.schema/query
    stage-number    :- :int
    expression-name :- ::lib.schema.common/non-blank-string]
   (or (maybe-resolve-expression query stage-number expression-name)
       (log/warnf "Expression %s does not exist in stage %d" (pr-str expression-name) (lib.util/canonical-stage-index query stage-number))
       (when-let [previous-stage-number (lib.util/previous-stage-number query stage-number)]
         (u/prog1 (resolve-expression query previous-stage-number expression-name)
           (when <>
             (log/warnf "Found expression %s in previous stage" (pr-str expression-name)))))
       (when (lib.util/first-stage? query stage-number)
         (when-let [source-card-id (lib.util/source-card-id query)]
           (when-let [source-card (lib.metadata/card query source-card-id)]
             (u/prog1 (resolve-expression ((#?(:clj requiring-resolve :cljs resolve) 'metabase.lib.query/query)
                                           (lib.metadata/->metadata-provider query)
                                           (:dataset-query source-card))
                                          expression-name)
               (when <>
                 (log/warnf "Found expression %s in source card %d. Next time, use a :field name ref!"
                            (pr-str expression-name) source-card-id))))))
       (throw (ex-info (i18n/tru "No expression named {0}" (pr-str expression-name))
                       {:expression-name expression-name
                        :query           query
                        :stage-number    stage-number})))))

(defmethod lib.metadata.calculation/type-of-method :expression
  [query stage-number [_expression _opts expression-name, :as _expression-ref]]
  (let [expression (resolve-expression query stage-number expression-name)]
    (lib.metadata.calculation/type-of query stage-number expression)))

(defmethod lib.metadata.calculation/metadata-method :expression
  [query stage-number [_expression opts expression-name, :as expression-ref-clause]]
  (merge {:lib/type            :metadata/column
          :lib/source-uuid     (:lib/uuid opts)
          :name                expression-name
          :lib/expression-name expression-name
          :display-name        (lib.metadata.calculation/display-name query stage-number expression-ref-clause)
          :base-type           (lib.metadata.calculation/type-of query stage-number expression-ref-clause)
          :lib/source          :source/expressions}
         (when-let [unit (lib.temporal-bucket/raw-temporal-bucket expression-ref-clause)]
           {:metabase.lib.field/temporal-unit unit})
         (when lib.metadata.calculation/*propagate-binning-and-bucketing*
           (when-let [unit (lib.temporal-bucket/raw-temporal-bucket expression-ref-clause)]
             {:inherited-temporal-unit unit}))))

(defmethod lib.temporal-bucket/available-temporal-buckets-method :expression
  [query stage-number [_expression opts _expr-name, :as expr-clause]]
  (lib.temporal-bucket/available-temporal-buckets-for-type
   (lib.metadata.calculation/type-of query stage-number expr-clause)
   :month
   (:temporal-unit opts)))

(defmethod lib.metadata.calculation/display-name-method :dispatch-type/integer
  [_query _stage-number n _style]
  (str n))

(defmethod lib.metadata.calculation/display-name-method :dispatch-type/number
  [_query _stage-number n _style]
  (str n))

(defmethod lib.metadata.calculation/display-name-method :dispatch-type/string
  [_query _stage-number s _style]
  (str \" s \"))

(defmethod lib.metadata.calculation/display-name-method :dispatch-type/boolean
  [_query _stage-number s _style]
  (str s))

(defmethod lib.metadata.calculation/display-name-method :expression
  [_query _stage-number [_expression {:keys [temporal-unit] :as _opts} expression-name] _style]
  (letfn [(temporal-format [display-name]
            (lib.util/format "%s: %s" display-name (-> (name temporal-unit)
                                                       (str/replace \- \space)
                                                       u/capitalize-en)))]
    (cond-> expression-name
      temporal-unit temporal-format)))

(defmethod lib.metadata.calculation/column-name-method :expression
  [_query _stage-number [_expression _opts expression-name]]
  expression-name)

(def ^:private ^:dynamic *nested*
  "Whether the display name we are generated is recursively nested inside another display name. For infix math operators
  we'll wrap the results in parentheses to make the display name more obvious."
  false)

(defn- wrap-str-in-parens-if-nested [s]
  (if *nested*
    (str \( s \))
    s))

(defn- infix-display-name
  "Generate a infix-style display name for an arithmetic expression like `:+`, e.g. `x + y`."
  [query stage-number operator args]
  (wrap-str-in-parens-if-nested
   (binding [*nested* true]
     (str/join (str \space (name operator) \space)
               (map (partial lib.metadata.calculation/display-name query stage-number)
                    args)))))

(def ^:private infix-operator-display-name
  {:+ "+"
   :- "-"
   :* "×"
   :/ "÷"})

(doseq [tag [:+ :- :/ :*]]
  (lib.hierarchy/derive tag ::infix-operator))

(defmethod lib.metadata.calculation/display-name-method ::infix-operator
  [query stage-number [tag _opts & args] _style]
  (infix-display-name query stage-number (get infix-operator-display-name tag) args))

(defmethod lib.metadata.calculation/column-name-method ::infix-operator
  [_query _stage-number _expr]
  "expression")

;;; `:+`, `:-`, and `:*` all have the same logic; also used for [[metabase.lib.schema.expression/type-of]].
;;;
;;; `:lib.type-of/type-is-type-of-arithmetic-args` is defined in [[metabase.lib.schema.expression.arithmetic]]
(defmethod lib.metadata.calculation/type-of-method :lib.type-of/type-is-type-of-arithmetic-args
  [query stage-number [_tag _opts & args]]
  ;; Okay to use reduce without an init value here since we know we have >= 2 args
  #_{:clj-kondo/ignore [:reduce-without-init]}
  (reduce
   types/most-specific-common-ancestor
   (for [arg args]
     (lib.metadata.calculation/type-of query stage-number arg))))

;;; TODO -- this stuff should probably be moved into [[metabase.lib.temporal-bucket]]

(defn- interval-unit-str [amount unit]
  ;; this uses [[clojure.string/lower-case]] so its in the user's locale in the browser rather than always using
  ;; English lower-casing rules.
  #_{:clj-kondo/ignore [:discouraged-var]}
  (str/lower-case (lib.temporal-bucket/describe-temporal-unit amount unit)))

(mu/defn- interval-display-name  :- ::lib.schema.common/non-blank-string
  "e.g. something like \"- 2 days\""
  [amount :- :int
   unit   :- ::lib.schema.temporal-bucketing/unit.date-time.interval]
  ;; TODO -- sorta duplicated with [[metabase.parameters.shared/translated-interval]], but not exactly
  (let [unit-str (interval-unit-str amount unit)]
    (wrap-str-in-parens-if-nested
     (if (pos? amount)
       (lib.util/format "+ %d %s" amount                    unit-str)
       (lib.util/format "- %d %s" (clojure.core/abs amount) unit-str)))))

(mu/defn- interval-column-name  :- ::lib.schema.common/non-blank-string
  "e.g. something like `minus_2_days`"
  [amount :- :int
   unit   :- ::lib.schema.temporal-bucketing/unit.date-time.interval]
  ;; TODO -- sorta duplicated with [[metabase.parameters.shared/translated-interval]], but not exactly
  (let [unit-str (interval-unit-str amount unit)]
    (if (pos? amount)
      (lib.util/format "plus_%s_%s"  amount                    unit-str)
      (lib.util/format "minus_%d_%s" (clojure.core/abs amount) unit-str))))

(defmethod lib.metadata.calculation/display-name-method :datetime-add
  [query stage-number [_datetime-add _opts x amount unit] style]
  (str (lib.metadata.calculation/display-name query stage-number x style)
       \space
       (interval-display-name amount unit)))

(defmethod lib.metadata.calculation/column-name-method :datetime-add
  [query stage-number [_datetime-add _opts x amount unit]]
  (str (lib.metadata.calculation/column-name query stage-number x)
       \_
       (interval-column-name amount unit)))

;;; for now we'll just pretend `:coalesce` isn't a present and just use the display name for the expr it wraps.
(defmethod lib.metadata.calculation/display-name-method :coalesce
  [query stage-number [_coalesce _opts expr _null-expr] style]
  (lib.metadata.calculation/display-name query stage-number expr style))

(defmethod lib.metadata.calculation/column-name-method :coalesce
  [query stage-number [_coalesce _opts expr _null-expr]]
  (lib.metadata.calculation/column-name query stage-number expr))

(defmethod lib.metadata.calculation/type-of-method :coalesce
  [query stage-number [_coalesce _opts expr null-expr]]
  (let [expr-type      (lib.metadata.calculation/type-of-method query stage-number expr)
        null-expr-type (lib.metadata.calculation/type-of-method query stage-number null-expr)]
    (lib.schema.expression.conditional/case-coalesce-return-type [expr-type null-expr-type])))

;;; believe it or not, a `:case` clause really has the syntax [:case {} [[pred1 expr1] [pred2 expr2] ...]]
;;; `:if` is an alias to `:case`
(doseq [tag [:case :if]]
  (lib.hierarchy/derive tag ::case))

(defmethod lib.metadata.calculation/type-of-method ::case
  [query stage-number [_case _opts cases fallback]]
  (let [case-exprs (map second cases)
        exprs      (cond-> case-exprs
                     fallback
                     (clojure.core/concat [fallback]))
        types      (map #(lib.metadata.calculation/type-of-method query stage-number %)
                        exprs)]
    (lib.schema.expression.conditional/case-coalesce-return-type types)))

(defmethod lib.temporal-bucket/with-temporal-bucket-method :expression
  [expr-ref unit]
  (lib.temporal-bucket/add-temporal-bucket-to-ref expr-ref unit))

(defmethod lib.temporal-bucket/temporal-bucket-method :expression
  [[_expression {:keys [temporal-unit]} _expr-name]]
  temporal-unit)

#_(defn- conflicting-name? [query stage-number expression-name]
    (let [stage     (lib.util/query-stage query stage-number)
          cols      (lib.metadata.calculation/visible-columns query stage-number stage)
          expr-name (u/lower-case-en expression-name)]
      (some #(-> % :name u/lower-case-en (= expr-name)) cols)))

(mr/def ::add-expression-options
  [:map
   ;; default: true
   [:add-to-fields? {:optional true} [:maybe :boolean]]])

(defn- add-expression-to-stage
  [stage
   expression
   {:keys [add-to-fields?], :or {add-to-fields? true}, :as _options}]
  (cond-> (update stage :expressions u/conjv expression)
    ;; if there are explicit fields selected, add the expression to them
    (and (vector? (:fields stage))
         add-to-fields?)
    ;; TODO: Construct this ref with lib/ref rather than hand-rolling it?
    (update :fields conj (lib.options/ensure-uuid [:expression {} (lib.util/expression-name expression)]))))

(mu/defn expression :- ::lib.schema/query
  "Adds an expression to query.

  Options:

  * `:add-to-fields?` (default: `true`) -- whether to add an `:expression` ref to `:fields` if one is present in the
    query."
  ([query expression-name expressionable]
   (expression query -1 expression-name expressionable))

  ([query stage-number expression-name expressionable]
   (expression query stage-number expression-name expressionable nil))

  ([query           :- ::lib.schema/query
    stage-number    :- [:maybe :int]
    expression-name :- ::lib.schema.common/non-blank-string
    expressionable
    options         :- [:maybe ::add-expression-options]]
   (let [stage-number   (or stage-number -1)
         expressionable (lib.common/->op-arg expressionable)]
     ;; TODO: This logic was removed as part of fixing #39059. We might want to bring it back for collisions with other
     ;; expressions in the same stage; probably not with tables or earlier stages. De-duplicating names is supported by
     ;; the QP code, and it should be powered by MLv2 in due course.
     #_(when (conflicting-name? query stage-number expression-name)
         (throw (ex-info "Expression name conflicts with a column in the same query stage"
                         {:expression-name expression-name})))
     (lib.util/update-query-stage
      query stage-number
      add-expression-to-stage
      (lib.util/top-level-expression-clause expressionable expression-name)
      options))))

(lib.common/defop + [x y & more])
(lib.common/defop - [x y & more])
(lib.common/defop * [x y & more])
;; Kondo gets confused
#_{:clj-kondo/ignore [:unresolved-namespace :syntax]}
(lib.common/defop / [x y & more])
(lib.common/defop ^{:style/indent [:form]} case [cases] [cases fallback])
(lib.common/defop coalesce [x y & more])
(lib.common/defop abs [x])
(lib.common/defop log [x])
(lib.common/defop exp [x])
(lib.common/defop sqrt [x])
(lib.common/defop ceil [x])
(lib.common/defop floor [x])
(lib.common/defop round [x])
(lib.common/defop power [n expo])
(lib.common/defop interval [n unit])
(lib.common/defop time [t unit])
(lib.common/defop absolute-datetime [t unit])
(lib.common/defop now [])
(lib.common/defop convert-timezone [t source dest])
(lib.common/defop get-week [t mode])
(lib.common/defop get-year [t])
(lib.common/defop get-month [t])
(lib.common/defop get-day [t])
(lib.common/defop get-hour [t])
(lib.common/defop get-minute [t])
(lib.common/defop get-second [t])
(lib.common/defop get-quarter [t])
(lib.common/defop get-day-of-week [t] [t mode])
(lib.common/defop datetime-add [t i unit])
(lib.common/defop date [s])
(lib.common/defop today [])
(lib.common/defop datetime-subtract [t i unit])
(lib.common/defop concat [s1 s2 & more])
(lib.common/defop substring [s start end])
(lib.common/defop split-part [s delimiter index])
(lib.common/defop replace [s search replacement])
(lib.common/defop regex-match-first [s regex])
(lib.common/defop length [s])
(lib.common/defop trim [s])
(lib.common/defop ltrim [s])
(lib.common/defop rtrim [s])
(lib.common/defop upper [s])
(lib.common/defop lower [s])
(lib.common/defop host [s])
(lib.common/defop domain [s])
(lib.common/defop subdomain [s])
(lib.common/defop path [s])
(lib.common/defop month-name [n])
(lib.common/defop quarter-name [n])
(lib.common/defop day-name [n])
(lib.common/defop offset [x n])
(lib.common/defop text [x])
(lib.common/defop integer [x])
(lib.common/defop float [x])

(mu/defn datetime :- :mbql.clause/datetime
  "Create a standalone clause of type `datetime`."
  ([value]
   (lib.common/defop-create :datetime [value]))
  ([value mode]
   (into [:datetime {:lib/uuid (str (random-uuid))
                     :mode mode}]
         (map lib.common/->op-arg) [value])))

(mu/defn relative-datetime :- :mbql.clause/relative-datetime
  "Create a standalone `:relative-datetime` clause."
  ([t :- [:= :current]]
   [:relative-datetime {:lib/uuid (str (random-uuid))} t])

  ([t    :- ::lib.schema.expression.temporal/relative-datetime.amount
    unit :- ::lib.schema.temporal-bucketing/unit.date-time.interval]
   [:relative-datetime {:lib/uuid (str (random-uuid))} t unit]))

(mu/defn value :- ::lib.schema.expression/expression
  "Creates a `:value` clause for the `literal`. Converts bigint literals to strings for serialization purposes."
  [literal :- [:or :string number? :boolean [:fn u.number/bigint?]]]
  (let [base-type (lib.schema.expression/type-of literal)]
    (lib.options/ensure-uuid [:value
                              {:base-type base-type, :effective-type base-type}
                              (cond-> literal (u.number/bigint? literal) str)])))

(mu/defn- expression-metadata :- ::lib.schema.metadata/column
  [query                 :- ::lib.schema/query
   stage-number          :- :int
   expression-definition :- ::lib.schema.expression/expression]
  (let [expression-name (lib.util/expression-name expression-definition)]
    (-> (lib.metadata.calculation/metadata query stage-number expression-definition)
        ;; We strip any properties a general expression cannot have, e.g. `:id` and
        ;; `:join-alias`. Keeping all properties a field can have would make it difficult
        ;; to distinguish the field column from an expression aliasing that field down the
        ;; line. It also doesn't make sense to keep the ID and the join alias, as they are
        ;; not the properties of the expression.
        (select-keys [:base-type :effective-type :lib/desired-column-alias
                      :lib/source-column-alias :lib/source-uuid :lib/type])
        (assoc :lib/source   :source/expressions
               :name         expression-name
               :display-name expression-name))))

(mu/defn expressions-metadata :- [:maybe [:sequential ::lib.schema.metadata/column]]
  "Get metadata about the expressions in a given stage of a `query`."
  ([query]
   (expressions-metadata query -1))

  ([query        :- ::lib.schema/query
    stage-number :- :int]
   (some->> (not-empty (:expressions (lib.util/query-stage query stage-number)))
            (mapv (partial expression-metadata query stage-number)))))

(mu/defn expressions :- [:maybe ::lib.schema.expression/expressions]
  "Get the expressions map from a given stage of a `query`."
  ([query]
   (expressions query -1))

  ([query        :- ::lib.schema/query
    stage-number :- :int]
   (not-empty (:expressions (lib.util/query-stage query stage-number)))))

(defmethod lib.ref/ref-method :expression
  [expression-clause]
  expression-clause)

(mu/defn expressionable-columns :- [:sequential ::lib.schema.metadata/column]
  "Get column metadata for all the columns that can be used expressions in
  the stage number `stage-number` of the query `query` and in expression index `expression-position`
  If `stage-number` is omitted, the last stage is used.
  Pass nil to `expression-position` for new expressions.
  The rules for determining which columns can be broken out by are as follows:

  1. Custom `:expressions` in this stage of the query`

  2. Fields 'exported' by the previous stage of the query, if there is one;
     otherwise Fields from the current `:source-table`

  3. Fields exported by explicit joins

  4. Fields in Tables that are implicitly joinable."

  ([query :- ::lib.schema/query
    expression-position :- [:maybe ::lib.schema.common/int-greater-than-or-equal-to-zero]]
   (expressionable-columns query -1 expression-position))

  ([query        :- ::lib.schema/query
    stage-number :- :int
    ;; The legacy format, which uses a map to represent the expressions, loses the ordering
    ;; if ten or more expressions are used. Preserving the order would require to use a
    ;; map type preserving the order both when converting to the legacy format and when
    ;; converting from JS to CLJ. This could be done by changing the legacy format or
    ;; using flatland.ordered.map/ordered-map or array-map or something similar.
    ;; Unfortunately, ordered-map doesn't implement IEditableCollection in CLJS, which means
    ;; that some functions (e.g., update-keys, update-vals) unexpectedly convert them to a
    ;; potentially unordered map. (One might even forget that select-keys returns a "normal"
    ;; Clojure map, so there are plenty of possibilities to mess this up.)
    ;; Changing the legacy/wire format is probably the right way to go, but that's a bigger
    ;; endeavor.
    expression-position :- [:maybe ::lib.schema.common/int-greater-than-or-equal-to-zero]]
   (let [stage (lib.util/query-stage query stage-number)
         expr-name (when expression-position
                     (some-> (expressions query stage-number)
                             (nth expression-position nil)
                             lib.util/expression-name))
         columns (cond->> (lib.metadata.calculation/visible-columns query stage-number stage)
                   expr-name (into [] (remove #(and (= (:lib/source %) :source/expressions)
                                                    (= (:name %) expr-name)))))]
     (not-empty columns))))

(mu/defn expression-ref :- :mbql.clause/expression
  "Find the expression with `expression-name` using [[resolve-expression]], then create a ref for it. Intended for use
  when creating queries using threading macros e.g.

    (-> (lib/query ...)
        (lib/expression \"My Expression\" ...)
        (as-> <> (lib/aggregate <> (lib/avg (lib/expression-ref <> \"My Expression\")))))"
  ([query expression-name]
   (expression-ref query -1 expression-name))

  ([query           :- ::lib.schema/query
    stage-number    :- :int
    expression-name :- ::lib.schema.common/non-blank-string]
   (->> expression-name
        (resolve-expression query stage-number)
        (expression-metadata query stage-number)
        lib.ref/ref)))

(def ^:private expression-validator
  (mr/validator ::lib.schema.expression/expression))

(defn expression-clause?
  "Returns true if `expression-clause` is indeed an expression clause, false otherwise."
  [expression-clause]
  (expression-validator expression-clause))

(mu/defn with-expression-name :- ::lib.schema.expression/expression
  "Return a new expression clause like `an-expression-clause` but with name `new-name`.
  For expressions from the :expressions clause of a pMBQL query this sets the :lib/expression-name option,
  for other expressions (for example named aggregation expressions) the :display-name option is set.

  Note that always setting :lib/expression-name would lead to confusion, because that option is used
  to decide what kind of reference is to be created. For example, expression are referenced by name,
  aggregations are referenced by position."
  [an-expression-clause :- ::lib.schema.expression/expression
   new-name :- :string]
  (lib.options/update-options
   (if (lib.util/clause? an-expression-clause)
     an-expression-clause
     [:value {:effective-type (lib.schema.expression/type-of an-expression-clause)}
      an-expression-clause])
   (fn [opts]
     (let [opts (assoc opts :lib/uuid (str (random-uuid)))]
       (if (:lib/expression-name opts)
         (-> opts
             (dissoc :display-name :name)
             (assoc :lib/expression-name new-name))
         (assoc opts :name new-name :display-name new-name))))))

(def ^:private aggregation-validator
  (mr/validator ::lib.schema.aggregation/aggregation))

(def ^:private filter-validator
  (mr/validator ::lib.schema/filterable))

(defn- expression->name
  [expr]
  (-> expr lib.options/options :lib/expression-name))

(defn- referred-expressions
  [expr]
  (into #{}
        (map #(get % 2))
        (lib.util.match/match expr :expression)))

(defn- aggregation->name
  [query stage-number aggregation]
  (lib.metadata.calculation/display-name query stage-number aggregation))

(defn- referred-aggregations
  [agg]
  (into #{}
        (map #(get % 2))
        (lib.util.match/match agg :aggregation)))

(defn- cyclic-definition
  ([node->children]
   (some #(cyclic-definition node->children %) (keys node->children)))
  ([node->children start]
   (cyclic-definition node->children start []))
  ([node->children node node-path]
   (if (some #{node} node-path)
     (drop-while (complement #{node}) (conj node-path node))
     (some #(cyclic-definition node->children % (conj node-path node))
           (node->children node)))))

(defn- aggregation-function?
  [tag]
  (lib.hierarchy/isa? tag ::lib.schema.aggregation/aggregation-clause-tag))

(defn- aggregation-expr?
  [expr]
  (and (vector? expr) (-> expr first aggregation-function?)))

(def ^:private window-function
  #{:cum-count :cum-sum :offset})

(defn- window-expression?
  [expr]
  (and (vector? expr) (-> expr first window-function boolean)))

(defn- invalid-nesting
  ([expr]
   (invalid-nesting expr []))
  ([expr path-tags]
   (cond
     (and (window-expression? expr)
          (some aggregation-function? path-tags))
     (first expr)

     (and (aggregation-expr? expr)
          (some (every-pred aggregation-function? (complement window-function)) path-tags))
     (first expr)

     (lib.util/clause? expr)
     (some #(invalid-nesting % (conj path-tags (first expr))) (nnext expr)))))

(mu/defn diagnose-expression :- [:maybe [:map [:message :string]]]
  "Checks `expr` for type errors and, if `expression-mode` is :expression and
  `expression-position` is provided, for cyclic references with other expressions.
  As a special case, it checks that window functions are not embedded in each other
  and in aggregation functions.

  - `expr` is a pMBQL expression usually created from a legacy MBQL expression created
  using the custom column editor in the FE. It is expected to have been normalized and
  converted using [[metabase.lib.convert/->pMBQL]].
  - `expression-mode` specifies what type of thing `expr` is: an :expression (custom column),
  an :aggregation expression, or a :filter condition.
  - `expression-position` is only defined when editing an existing custom column, and in that case
  it is the index of that expression in (expressions query stage-number).

  The function returns nil, if the expression is valid, otherwise it returns a map with
  an i18n message describing the problem under the key :message."
  [query               :- ::lib.schema/query
   stage-number        :- :int
   expression-mode     :- [:enum :expression :aggregation :filter]
   expr                :- :any
   expression-position :- [:maybe :int]]
  (binding [lib.schema.expression/*suppress-expression-type-check?* false]
    (let [validator (clojure.core/case expression-mode
                      :expression expression-validator
                      :aggregation aggregation-validator
                      :filter filter-validator)]
      (or (when-not (validator expr)
            {:message  (i18n/tru "Types are incompatible.")
             :friendly true})
          (when-let [dependency-path
                     (when expression-position
                       (clojure.core/case expression-mode
                         :expression (let [exprs (expressions query stage-number)
                                           edited-expr (nth exprs expression-position)
                                           edited-name (expression->name edited-expr)
                                           deps (-> (m/index-by expression->name exprs)
                                                    (assoc edited-name expr)
                                                    (update-vals referred-expressions))]
                                       (cyclic-definition deps))
                         :aggregation (let [aggs (:aggregation (lib.util/query-stage query stage-number))
                                            edited-expr (assoc expr 1 (get-in aggs [expression-position 1]))
                                            uuid->agg (-> aggs
                                                          (assoc expression-position edited-expr)
                                                          (->> (m/index-by lib.options/uuid)))
                                            deps (update-vals uuid->agg referred-aggregations)]
                                        (some->> (cyclic-definition deps)
                                                 (map (comp #(aggregation->name query stage-number %)
                                                            uuid->agg))))
                         nil))]
            {:message (i18n/tru "Cycle detected: {0}" (str/join " → " dependency-path))
             :friendly true})
          (when-let [nested (invalid-nesting expr)]
            {:message (i18n/tru "Embedding {0} in aggregation functions is not supported"
                                ;; special names duplicated from
                                ;; frontend/src/metabase/querying/expressions/config.ts
                                (clojure.core/case nested
                                  :avg            "Average"
                                  :count-where    "CountIf"
                                  :cum-count      "CumulativeCount"
                                  :cum-sum        "CumulativeSum"
                                  :distinct-where "DistinctIf"
                                  :stddev         "StandardDeviation"
                                  :sum-where      "SumIf"
                                  :var            "Variance"
                                  (-> nested name u/->camelCaseEn u/capitalize-first-char)))
             :friendly true})
          (when (and (= expression-mode :expression)
                     (lib.util.match/match-lite-recursive expr :offset true))
            {:message  (i18n/tru "OFFSET is not supported in custom columns")
             :friendly true})
          (when (and (= expression-mode :filter)
                     (lib.util.match/match-lite-recursive expr :offset true))
            {:message  (i18n/tru "OFFSET is not supported in custom filters")
             :friendly true})
          (when (and (lib.schema.common/is-clause? :value expr)
                     (not (lib.metadata/database-supports? query :expression-literals)))
            {:message  (i18n/tru "Standalone constants are not supported.")
             :friendly true})))))
