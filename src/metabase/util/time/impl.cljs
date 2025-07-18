(ns metabase.util.time.impl
  "CLJS implementation of the time utilities on top of Moment.js.
  See [[metabase.util.time]] for the public interface."
  (:require
   ["moment" :as moment]
   [metabase.util.time.impl-common :as common]))

(defn- now [] (moment))

;;; ----------------------------------------------- predicates -------------------------------------------------------
(defn datetime?
  "Given any value, check if it's a (possibly invalid) Moment."
  [value]
  (and value (moment/isMoment value)))

(defn time?
  "checks if the provided value is a local time value."
  [value]
  (moment/isMoment value))

(defn valid?
  "Given a Moment, check that it's valid."
  [value]
  (and (datetime? value) (.isValid ^moment/Moment value)))

(defn normalize
  "Does nothing. Just a placeholder in CLJS; the JVM implementation does some real work."
  [value]
  value)

(defn same-day?
  "Given two platform-specific datetimes, checks if they fall within the same day."
  [^moment/Moment d1 ^moment/Moment d2]
  (.isSame d1 d2 "day"))

(defn same-month?
  "True if these two datetimes fall in the same (year and) month."
  [^moment/Moment d1 ^moment/Moment d2]
  (.isSame d1 d2 "month"))

(defn same-year?
  "True if these two datetimes fall in the same year."
  [^moment/Moment d1 ^moment/Moment d2]
  (.isSame d1 d2 "year"))

;;; ---------------------------------------------- information -------------------------------------------------------
(defn first-day-of-week
  "The first day of the week varies by locale, but Metabase has a setting that overrides it.
  In CLJS, Moment is already configured with that setting."
  []
  (nth [:sunday :monday :tuesday :wednesday :thursday :friday :saturday]
       (.firstDayOfWeek (moment/localeData))))

(def default-options
  "The default map of options - empty in CLJS."
  {})

;;; ------------------------------------------------ to-range --------------------------------------------------------
(defn- apply-offset
  [^moment/Moment value offset-n offset-unit]
  (.add
   (moment value)
   offset-n
   (name offset-unit)))

(defmethod common/to-range :default [^moment/Moment value {:keys [n unit]}]
  (let [^moment/Moment c1       (.clone value)
        ^moment/Moment c2       (.clone value)
        ^moment/Moment adjusted (if (> n 1)
                                  (.add c2 (dec n) (name unit))
                                  c2)]
    [(.startOf c1       (name unit))
     (.endOf   adjusted (name unit))]))

;; NB: Only the :default for to-range is needed in CLJS, since Moment's startOf and endOf methods are doing the work.

;;; -------------------------------------------- string->timestamp ---------------------------------------------------
(defmethod common/string->timestamp :default [value _]
  ;; Best effort to parse this unknown string format, as a local zoneless datetime, then treating it as UTC.
  (moment/utc value moment/ISO_8601))

(defmethod common/string->timestamp :day-of-week [value options]
  ;; Try to parse as a regular timestamp; if that fails then try to treat it as a weekday name and adjust from
  ;; the current time.
  (let [as-default (try ((get-method common/string->timestamp :default) value options)
                        (catch js/Error _ nil))]
    (if (valid? as-default)
      as-default
      (-> (now)
          (.isoWeekday value)
          (.startOf "day")))))

;;; -------------------------------------------- number->timestamp ---------------------------------------------------
(defn- magic-base-date
  "Some of the date coercions are relative, and not directly involved with any particular month.
  To avoid errors we need to use a reference date that is (a) in a month with 31 days,(b) in a leap year.
  This uses 2016-01-01 for the purpose.
  This is a function that returns fresh values, since Moments are mutable."
  []
  (moment "2016-01-01"))

(defmethod common/number->timestamp :default [value _]
  ;; If no unit is given, or the unit is not recognized, try to parse the number as year number, returning the timestamp
  ;; for midnight UTC on January 1.
  (moment/utc value moment/ISO_8601))

(defmethod common/number->timestamp :minute-of-hour [value _]
  (.. (now) (minute value) (startOf "minute")))

(defmethod common/number->timestamp :hour-of-day [value _]
  (.. (now) (hour value) (startOf "hour")))

(defmethod common/number->timestamp :day-of-week [value _]
  ;; Metabase uses 1 to mean the start of the week, based on the Metabase setting for the first day of the week.
  ;; Moment uses 0 as the first day of the week in its configured locale.
  (.. (now) (weekday (dec value)) (startOf "day")))

(defmethod common/number->timestamp :day-of-week-iso [value _]
  (.. (now) (isoWeekday value) (startOf "day")))

(defmethod common/number->timestamp :day-of-month [value _]
  ;; We force the initial date to be in a month with 31 days.
  (.. (magic-base-date) (date value) (startOf "day")))

(defmethod common/number->timestamp :day-of-year [value _]
  ;; We force the initial date to be in a leap year (2016).
  (.. (magic-base-date) (dayOfYear value) (startOf "day")))

(defmethod common/number->timestamp :week-of-year [value _]
  (.. (now) (week value) (startOf "week")))

(defmethod common/number->timestamp :month-of-year [value _]
  (.. (now) (month (dec value)) (startOf "month")))

(defmethod common/number->timestamp :quarter-of-year [value _]
  (.. (now) (quarter value) (startOf "quarter")))

(defmethod common/number->timestamp :year [value _]
  (.. (now) (year value) (startOf "year")))

;;; ---------------------------------------------- parsing helpers ---------------------------------------------------
(defn parse-with-zone
  "Parses a timestamp with Z or a timezone offset at the end.
  This requires a different API call from timestamps without time zones in CLJS."
  [value]
  (moment/parseZone value))

(defn localize
  "Given a freshly parsed absolute Moment, convert it to a local one."
  [value]
  (.local value))

(def ^:private parse-time-formats
  #js ["HH:mm:ss.SSSZ"
       "HH:mm:ss.SSS"
       "HH:mm:ss"
       "HH:mm"])

(defn parse-time-string
  "Parses a time string that has been stripped of any time zone."
  [value]
  (moment value parse-time-formats))

;;; ----------------------------------------------- constructors -----------------------------------------------------
(defn local-time
  "Constructs a platform time value (eg. Moment, LocalTime) for the given hour and minute, plus optional seconds and
  milliseconds.

  If called without arguments, returns the current time."
  ([]
   ;; Actually a full datetime, but Moment doesn't have freestanding time values.
   (moment))
  ([hours minutes]
   (moment #js {:hours hours, :minutes minutes}))
  ([hours minutes seconds]
   (moment #js {:hours hours, :minutes minutes, :seconds seconds}))
  ([hours minutes seconds millis]
   (moment #js {:hours hours, :minutes minutes, :seconds seconds, :milliseconds millis})))

(declare truncate)

(defn local-date
  "Constructs a platform date value (eg. Moment, LocalDate) for the given year, month and day.

  Day is 1-31. January = 1, or you can specify keywords like `:jan`, `:jun`."
  ([] (truncate (moment) :day))
  ([year month day]
   (moment #js {:year  year
                :day   day
                ;; Moment uses 0-based months, unlike Metabase.
                :month (dec (or (common/month-keywords month) month))})))

(defn local-date-time
  "Constructs a platform datetime (eg. Moment, LocalDateTime).

  Accepts either:
  - no arguments (current datetime)
  - a local date and local time (see [[local-date]] and [[local-time]]); or
  - year, month, day, hour, and minute, plus optional seconds and millis."
  ([] (moment))
  ([a-date a-time]
   (when-not (and (valid? a-date) (valid? a-time))
     (throw (ex-info "Expected valid Moments for date and time" {:date a-date
                                                                 :time a-time})))
   (let [^moment/Moment d (.clone a-date)
         ^moment/Moment t a-time]
     (doseq [unit ["hour" "minute" "second" "millisecond"]]
       (.set d unit (.get t unit)))
     d))
  ([year month day hours minutes]
   (local-date-time (local-date year month day) (local-time hours minutes)))
  ([year month day hours minutes seconds]
   (local-date-time (local-date year month day) (local-time hours minutes seconds)))
  ([year month day hours minutes seconds millis]
   (local-date-time (local-date year month day) (local-time hours minutes seconds millis))))

;;; ------------------------------------------------ arithmetic ------------------------------------------------------

(declare unit-diff)

(defn day-diff
  "Returns the time elapsed between `before` and `after` in days."
  [before after]
  (unit-diff :day before after))

(defn- coerce-local-date-time [input]
  (-> input
      common/drop-trailing-time-zone
      (moment/utc moment/ISO_8601)))

(def ^:private unit-formats
  {:day-of-week        "dddd"
   :day-of-week-abbrev "ddd"
   :day-of-week-iso    "dddd"
   :month-of-year      "MMM"
   :month-of-year-full "MMMM"
   :minute-of-hour     "m"
   :hour-of-day        "h A"
   :hour-of-day-24     "h"
   :day-of-month       "D"
   :day-of-year        "DDD"
   :week-of-year       "w"
   :quarter-of-year    "[Q]Q"})

(defn ^:private format-extraction-unit
  "Formats a date-time value given the temporal extraction unit.
  If unit is not supported, returns nil."
  [t unit locale]
  (when-some [format (get unit-formats unit)]
    (if locale
      (-> t
          (.locale locale)
          (.format format))
      (.format t format))))

(defn- has-explicit-time?
  "Does this moment value have explicit time parts (i.e., what it parsed with time components?"
  [m]
  ;; type hints to quell warnings from compiler
  (let [^js/Object flags (.parsingFlags ^moment/Moment m)
        ^js/Array parts (.-parsedDateParts flags)]
    (when parts
      (some (fn [i] (aget parts i)) [3 ;; hours
                                     4 ;; minutes
                                     5 ;; seconds
                                     ]))))

(defn- has-explicit-date?
  "Does this moment value have explicit date parts (i.e., what it parsed with date components?"
  [m]
  ;; type hints to quell warnings from compiler
  (let [^js/Object flags (.parsingFlags ^moment/Moment m)
        ^js/Array parts (.-parsedDateParts flags)]
    (when parts
      (some (fn [i] (aget parts i)) [0 ;; year
                                     1 ;; month
                                     2 ;; day
                                     ]))))

(defn format-unit
  "Formats a temporal-value (iso date/time string, int for extraction units) given the temporal-bucketing unit.
   If unit is nil, formats the full date/time.
   Time input formatting is only defined with time units."
  ;; This third argument is needed for the JVM side; it can be ignored here.
  ([input unit] (format-unit input unit nil))
  ([input unit locale]
   (cond
     (string? input)
     (let [time? (common/matches-time? input)
           date? (common/matches-date? input)
           date-time? (common/matches-date-time? input)
           t (cond
               ;; Anchor to an arbitrary date since time inputs are only defined for
               ;; :hour-of-day and :minute-of-hour.
               time? (moment/utc (str "2023-01-01T" input) moment/ISO_8601)
               (or date? date-time?) (coerce-local-date-time input))]
       (if (and t (.isValid t))
         (or
          (format-extraction-unit t unit locale)
          ;; no locale for default formats
          (cond
            time? (.format t "h:mm A")
            date? (.format t "MMM D, YYYY")
            date-time? (.format t "MMM D, YYYY, h:mm A")))
         input))

     (number? input)
     (if (= unit :hour-of-day)
       (str (cond (zero? input) "12" (<= input 12) input :else (- input 12)) " " (if (<= input 11) "AM" "PM"))
       (or
        (format-extraction-unit (common/number->timestamp input {:unit unit}) unit locale)
        (str input)))

     (moment/isMoment input)
     (or (format-extraction-unit input unit locale)
         ;; no locale for default formats
         (cond
           ;; no hour, minute, or seconds, must be date
           (not (has-explicit-time? input))
           (.format input "MMM D, YYYY")

           ;; no year, month, or day, must be a time
           (not (has-explicit-date? input))
           (.format input "h:mm A")

           :else ;; otherwise both date and time
           (.format input "MMM D, YYYY, h:mm A"))))))

(defn parse-unit
  "Parse a unit of time/date, e.g., 'Wed' or 'August' or '14'."
  ([input unit]
   (when-some [format (get unit-formats unit)]
     (moment input format)))
  ([input unit locale]
   (let [temp (.locale moment)]     ;; 1. save current locale
     (try
       (.locale moment locale)      ;; 2. set new locale for subsequent parse
       (parse-unit input unit)
       (finally
         (.locale moment temp)))))) ;; 3. set locale to original

(defn format-diff
  "Formats a time difference between two temporal values.
   Drops redundant information."
  [temporal-value-1 temporal-value-2]
  (let [default-format #(str (format-unit temporal-value-1 nil)
                             " – "
                             (format-unit temporal-value-2 nil))]
    (cond
      (some (complement string?) [temporal-value-1 temporal-value-2])
      (default-format)

      (= temporal-value-1 temporal-value-2)
      (format-unit temporal-value-1 nil)

      (and (common/matches-time? temporal-value-1)
           (common/matches-time? temporal-value-2))
      (default-format)

      (and (common/matches-date-time? temporal-value-1)
           (common/matches-date-time? temporal-value-2))
      (let [lhs (coerce-local-date-time temporal-value-1)
            rhs (coerce-local-date-time temporal-value-2)
            year-matches? (= (.format lhs "YYYY") (.format rhs "YYYY"))
            month-matches? (= (.format lhs "MMM") (.format rhs "MMM"))
            day-matches? (= (.format lhs "D") (.format rhs "D"))
            hour-matches? (= (.format lhs "HH") (.format rhs "HH"))
            [lhs-fmt rhs-fmt] (cond
                                (and year-matches? month-matches? day-matches? hour-matches?)
                                ["MMM D, YYYY, h:mm A " " h:mm A"]

                                (and year-matches? month-matches? day-matches?)
                                ["MMM D, YYYY, h:mm A " " h:mm A"]

                                year-matches?
                                ["MMM D, h:mm A " " MMM D, YYYY, h:mm A"])]

        (if lhs-fmt
          (str (.format lhs lhs-fmt) "–" (.format rhs rhs-fmt))
          (default-format)))

      (and (common/matches-date? temporal-value-1)
           (common/matches-date? temporal-value-2))
      (let [lhs (moment/utc temporal-value-1 moment/ISO_8601)
            rhs (moment/utc temporal-value-2 moment/ISO_8601)
            year-matches? (= (.format lhs "YYYY") (.format rhs "YYYY"))
            month-matches? (= (.format lhs "MMM") (.format rhs "MMM"))
            [lhs-fmt rhs-fmt] (cond
                                (and year-matches? month-matches?)
                                ["MMM D" "D, YYYY"]

                                year-matches?
                                ["MMM D " " MMM D, YYYY"])]
        (if lhs-fmt
          (str (.format lhs lhs-fmt) "–" (.format rhs rhs-fmt))
          (default-format)))

      :else
      (default-format))))

(defn format-relative-date-range
  "Given a `n` `unit` time interval and the current date, return a string representing the date-time range.
   Provide an `offset-n` and `offset-unit` time interval to change the date used relative to the current date.
   `options` is a map and supports `:include-current` to include the current given unit of time in the range."
  ([n unit offset-n offset-unit opts]
   (format-relative-date-range (now) n unit offset-n offset-unit opts))
  ([t n unit offset-n offset-unit {:keys [include-current]}]
   (let [offset-now (cond-> t
                      (neg? n) (apply-offset n unit)
                      (and (pos? n) (not include-current)) (apply-offset 1 unit)
                      (and offset-n offset-unit) (apply-offset offset-n offset-unit))
         pos-n (cond-> (abs n)
                 include-current inc)
         date-ranges (map #(.format % (if (#{:hour :minute} unit) "YYYY-MM-DDTHH:mm" "YYYY-MM-DD"))
                          (common/to-range offset-now
                                           {:unit unit
                                            :n pos-n
                                            :offset-n offset-n
                                            :offset-unit offset-unit}))]
     (apply format-diff date-ranges))))

(def ^:private temporal-formats
  {:offset-date-time {:regex   common/offset-datetime-regex
                      :formats #js ["YYYY-MM-DDTHH:mm:ss.SSSZ"
                                    "YYYY-MM-DDTHH:mm:ssZ"
                                    "YYYY-MM-DDTHH:mmZ"]}
   :local-date-time  {:regex   common/local-datetime-regex
                      :formats #js ["YYYY-MM-DDTHH:mm:ss.SSS"
                                    "YYYY-MM-DDTHH:mm:ss"
                                    "YYYY-MM-DDTHH:mm"]}
   :local-date       {:regex   common/local-date-regex
                      :formats #js ["YYYY-MM-DD"
                                    "YYYY-MM"
                                    "YYYY"]}
   :offset-time      {:regex   common/offset-time-regex
                      :formats #js ["HH:mm:ss.SSSZ"
                                    "HH:mm:ssZ"
                                    "HH:mmZ"]}
   :local-time       {:regex   common/local-time-regex
                      :formats #js ["HH:mm:ss.SSS"
                                    "HH:mm:ss"
                                    "HH:mm"]}})

(defn- iso-8601->moment+type
  [s]
  (some (fn [[value-type {:keys [regex formats]}]]
          (when (re-matches regex s)
            (let [parsed (moment/parseZone s formats #_strict? true)]
              (when (.isValid parsed)
                [parsed value-type]))))
        temporal-formats))

(comment
  (moment "01:49:10.858Z" "HH:mm:ss.SSSZ")

  (let [s "1982-03-16T01:49:10.858Z"
        formats #js ["YYYY-MM-DDTHH:mm:ss.SSS[Z]"]
        formatz #js ["YYYY-MM-DDTHH:mm:ss.SSSZ"]
        s-parsed (moment/parseZone s formats #_strict? true)
        z-parsed (moment/parseZone s formatz #_strict? true)]
    {:tz (.. (js/Intl.DateTimeFormat) resolvedOptions -timeZone)
     :tzo (.getTimezoneOffset (js/Date.)) #_mins
     :s s-parsed
     :z z-parsed
     :fz (.format z-parsed "YYYY-MM-DDTHH:mm:ss.SSSZ")
     :fs (.format z-parsed "YYYY-MM-DDTHH:mm:ss.SSS[Z]")})
  -)

(defmulti ^:private moment+type->iso-8601
  {:arglists '([moment+type])}
  (fn [[_t value-type]]
    value-type))

(defmethod moment+type->iso-8601 :offset-date-time
  [[^moment/Moment t _value-type]]
  (let [format-string (cond
                        (pos? (.millisecond t)) "YYYY-MM-DDTHH:mm:ss.SSS[Z]"
                        (pos? (.second t))      "YYYY-MM-DDTHH:mm:ss[Z]"
                        :else                    "YYYY-MM-DDTHH:mm[Z]")]
    (.format t format-string)))

(defmethod moment+type->iso-8601 :local-date-time
  [[^moment/Moment t _value-type]]
  (let [format-string (cond
                        (pos? (.millisecond t)) "YYYY-MM-DDTHH:mm:ss.SSS"
                        (pos? (.second t))      "YYYY-MM-DDTHH:mm:ss"
                        :else                    "YYYY-MM-DDTHH:mm")]
    (.format t format-string)))

(defmethod moment+type->iso-8601 :local-date
  [[^moment/Moment t _value-type]]
  (.format t "YYYY-MM-DD"))

(defmethod moment+type->iso-8601 :offset-time
  [[^moment/Moment t _value-type]]
  (let [format-string (cond
                        (pos? (.millisecond t)) "HH:mm:ss.SSS[Z]"
                        (pos? (.second t))      "HH:mm:ss[Z]"
                        :else                    "HH:mm[Z]")]
    (.format t format-string)))

(defmethod moment+type->iso-8601 :local-time
  [[^moment/Moment t _value-type]]
  (let [format-string (cond
                        (pos? (.millisecond t)) "HH:mm:ss.SSS"
                        (pos? (.second t))      "HH:mm:ss"
                        :else                    "HH:mm")]
    (.format t format-string)))

(defn- ->moment ^moment/Moment [t]
  (if (instance? js/Date t)
    (moment/utc t)
    t))

(defn unit-diff
  "Return the number of `unit`s between two temporal values `before` and `after`, e.g. maybe there are 32 `:day`s
  between Jan 1st and Feb 2nd."
  [unit before after]
  (let [^moment/Moment before (if (string? before)
                                (first (iso-8601->moment+type before))
                                (->moment before))
        ^moment/Moment after  (if (string? after)
                                (first (iso-8601->moment+type after))
                                (->moment after))]
    (.diff after before (name unit))))

(defn truncate
  "ClojureScript implementation of [[metabase.util.time/truncate]]; supports both Moment.js instances and ISO-8601
  strings."
  [t unit]
  (if (string? t)
    (let [[t value-type] (iso-8601->moment+type t)
          t              (truncate t unit)]
      (moment+type->iso-8601 [t value-type]))
    (let [^moment/Moment t (->moment t)]
      (.startOf t (name unit)))))

(defn add
  "ClojureScript implementation of [[metabase.util.time/add]]; supports both Moment.js instances and ISO-8601 strings."
  [t unit amount]
  (if (string? t)
    (let [[t value-type] (iso-8601->moment+type t)
          t              (add t unit amount)]
      (moment+type->iso-8601 [t value-type]))
    (let [^moment/Moment t (->moment t)]
      (.add t amount (name unit)))))

(defn format-for-base-type
  "ClojureScript implementation of [[metabase.util.time/format-for-base-type]]; format a temporal value as an ISO-8601
  string appropriate for a value of the given `base-type`, e.g. a `:type/Time` gets formatted as a `HH:mm:ss.SSS`
  string."
  [t base-type]
  (if (string? t)
    t
    (let [t          (->moment t)
          value-type (condp #(isa? %2 %1) base-type
                       :type/TimeWithTZ     :offset-time
                       :type/Time           :local-time
                       :type/DateTimeWithTZ :offset-date-time
                       :type/DateTime       :local-date-time
                       :type/Date           :local-date)]
      (moment+type->iso-8601 [t value-type]))))

(defn extract
  "Extract a field such as `:minute-of-hour` from a temporal value `t`."
  [^moment/Moment t unit]
  (case unit
    :second-of-minute (.second t)
    :minute-of-hour   (.minute t)
    :hour-of-day      (.hour t)
    :day-of-week      (inc (.weekday t)) ;; `weekday` is 0-6, where 0 corresponds to the first day of week
    :day-of-week-iso  (.isoWeekday t)
    :day-of-month     (.date t)
    :day-of-year      (.dayOfYear t)
    :week-of-year     (.week t)
    :month-of-year    (inc (.month t)) ;; `month` is 0-11
    :quarter-of-year  (.quarter t)
    :year             (.year t)))
