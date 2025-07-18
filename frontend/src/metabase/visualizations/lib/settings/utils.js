import {
  columnsAreValid,
  getDefaultDimensionAndMetric,
} from "metabase/visualizations/lib/utils";
import { isDimension, isMetric } from "metabase-lib/v1/types/utils/isa";

export function getOptionFromColumn(col) {
  return {
    name: col.display_name,
    value: col.name,
  };
}

export function metricSetting(id, def = {}) {
  return fieldSetting(id, {
    fieldFilter: isMetric,
    getDefault: (series) => getDefaultDimensionAndMetric(series).metric,
    ...def,
  });
}

export function dimensionSetting(id, def = {}) {
  return fieldSetting(id, {
    fieldFilter: isDimension,
    getDefault: (series) => getDefaultDimensionAndMetric(series).dimension,
    ...def,
  });
}

const DEFAULT_FIELD_FILTER = (column) => true;

export function getDefaultColumn(
  series,
  vizSettings,
  fieldFilter = DEFAULT_FIELD_FILTER,
) {
  const [{ data }] = series;
  return data.cols.find(fieldFilter)?.name;
}

/**
 * @typedef {import("metabase/visualizations/types").VisualizationSettingsDefinitions} VisualizationSettingsDefinitions
 * @typedef {(column: DatasetColumn) => boolean} FieldFilterFn
 */

/**
 * @param {string} id
 * @param {VisualizationSettingsDefinitions[string] & { fieldFilter?: FieldFilterFn }} settings
 * @returns {VisualizationSettingsDefinitions}
 */
export function fieldSetting(
  id,
  {
    fieldFilter = DEFAULT_FIELD_FILTER,
    showColumnSetting,
    autoOpenWhenUnset,
    ...def
  } = {},
) {
  return {
    [id]: {
      widget: "field",
      isValid: ([{ card, data }], vizSettings) =>
        columnsAreValid(card.visualization_settings[id], data, fieldFilter),
      getDefault: (series, vizSettings) =>
        getDefaultColumn(series, vizSettings, fieldFilter),
      getProps: ([{ card, data }], vizSettings) => ({
        options: data.cols.filter(fieldFilter).map(getOptionFromColumn),
        columns: data.cols,
        showColumnSetting,
        autoOpenWhenUnset,
      }),
      ...def,
    },
  };
}
