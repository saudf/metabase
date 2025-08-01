import type { CommonStylingProps } from "embedding-sdk/types/props";
import type { UpdateQueryHookProps } from "metabase/query_builder/hooks";
import {
  FilterPicker as InnerFilterPicker,
  type FilterPickerProps as InnerFilterPickerProps,
} from "metabase/querying/filters/components/FilterPicker";
import { Box } from "metabase/ui";
import type * as Lib from "metabase-lib";

import { useSdkQuestionContext } from "../../../context";
import type { SDKFilterItem } from "../hooks/use-filter-data";
import { useFilterHandlers } from "../hooks/use-filter-handlers";

/**
 * @interface
 */
type Props = {
  filterItem?: SDKFilterItem;
  withIcon?: boolean;
} & CommonStylingProps &
  Pick<InnerFilterPickerProps, "onClose" | "onBack">;

const FilterPickerInner = ({
  className,
  style,
  filterItem,
  withIcon = false,
  onClose,
  onBack,
  query,
  stageIndex,
  onQueryChange,
}: Props & UpdateQueryHookProps) => {
  const { onAddFilter } = useFilterHandlers({
    query,
    stageIndex,
    onQueryChange,
  });
  return (
    <Box className={className} style={style}>
      <InnerFilterPicker
        query={query}
        stageIndex={stageIndex}
        onClose={onClose}
        onBack={onBack}
        onSelect={(filter) =>
          filterItem ? filterItem?.onUpdateFilter(filter) : onAddFilter(filter)
        }
        filter={filterItem?.filter}
        filterIndex={filterItem?.filterIndex}
        withCustomExpression={false}
        withColumnGroupIcon={false}
        withColumnItemIcon={withIcon}
      />
    </Box>
  );
};

export const FilterPicker = ({
  filterItem,
  className,
  withIcon,
  onClose,
  onBack,
}: Props) => {
  const { question, updateQuestion } = useSdkQuestionContext();

  if (!question) {
    return null;
  }

  const onQueryChange = (query: Lib.Query) => {
    if (query) {
      updateQuestion(question.setQuery(query), { run: true });
    }
  };

  const query = question.query();
  const stageIndex = -1;

  return (
    <FilterPickerInner
      filterItem={filterItem}
      className={className}
      withIcon={withIcon}
      onClose={onClose}
      onBack={onBack}
      query={query}
      stageIndex={stageIndex}
      onQueryChange={onQueryChange}
    />
  );
};
