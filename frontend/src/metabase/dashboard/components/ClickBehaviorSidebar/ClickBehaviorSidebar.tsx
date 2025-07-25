import { getIn } from "icepick";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMount, usePrevious } from "react-use";

import { useDashboardQuery } from "metabase/common/hooks";
import { Sidebar } from "metabase/dashboard/components/Sidebar";
import {
  type DashboardContextReturned,
  useDashboardContext,
} from "metabase/dashboard/context";
import { isTableDisplay } from "metabase/lib/click-behavior";
import {
  canSaveClickBehavior,
  clickBehaviorIsValid,
} from "metabase-lib/v1/parameters/utils/click-behavior";
import { getColumnKey } from "metabase-lib/v1/queries/utils/column-key";
import type {
  ClickBehavior,
  DashCardVisualizationSettings,
  DatasetColumn,
} from "metabase-types/api";

import { ClickBehaviorSidebarContent } from "./ClickBehaviorSidebarContent";
import { ClickBehaviorSidebarHeader } from "./ClickBehaviorSidebarHeader/ClickBehaviorSidebarHeader";
import { getClickBehaviorForColumn } from "./utils";

function shouldShowTypeSelector(clickBehavior?: ClickBehavior) {
  return !clickBehavior || clickBehavior.type == null;
}

export function ClickBehaviorSidebarInner({
  dashboard,
  clickBehaviorSidebarDashcard: dashcard,
}: {
  dashboard: NonNullable<DashboardContextReturned["dashboard"]>;
  clickBehaviorSidebarDashcard: NonNullable<
    DashboardContextReturned["clickBehaviorSidebarDashcard"]
  >;
}) {
  const {
    parameters,
    closeSidebar: hideClickBehaviorSidebar,
    onUpdateDashCardColumnSettings,
    onUpdateDashCardVisualizationSettings,
    onReplaceAllDashCardVisualizationSettings,
  } = useDashboardContext();

  const [isTypeSelectorVisible, setTypeSelectorVisible] = useState<
    boolean | null
  >(null);

  const [selectedColumn, setSelectedColumn] = useState<DatasetColumn | null>(
    null,
  );

  const [originalVizSettings, setOriginalVizSettings] = useState<
    DashCardVisualizationSettings | null | undefined
  >(null);

  const [originalColumnVizSettings, setOriginalColumnVizSettings] = useState<
    Partial<ClickBehavior> | undefined | null
  >(null);

  const previousDashcard = usePrevious(dashcard);
  const hasSelectedColumn = selectedColumn != null;

  const clickBehavior: ClickBehavior | undefined = useMemo(() => {
    if (isTableDisplay(dashcard) && !hasSelectedColumn) {
      return;
    }
    if (hasSelectedColumn) {
      return getClickBehaviorForColumn(dashcard, selectedColumn);
    } else {
      return getIn(dashcard, ["visualization_settings", "click_behavior"]);
    }
  }, [dashcard, selectedColumn, hasSelectedColumn]);

  const isDashboardLink =
    clickBehavior?.type === "link" && clickBehavior.linkType === "dashboard";
  const { data: targetDashboard } = useDashboardQuery({
    enabled: isDashboardLink,
    id: isDashboardLink ? clickBehavior.targetId : undefined,
  });

  const isValidClickBehavior = useMemo(
    () => clickBehaviorIsValid(clickBehavior),
    [clickBehavior],
  );

  const isCloseDisabled = useMemo(
    () => !canSaveClickBehavior(clickBehavior, targetDashboard),
    [clickBehavior, targetDashboard],
  );

  const handleChangeSettings = useCallback(
    (nextClickBehavior: Partial<ClickBehavior> | undefined | null) => {
      const { id } = dashcard;

      if (selectedColumn == null) {
        onUpdateDashCardVisualizationSettings(id, {
          click_behavior: nextClickBehavior,
        });
      } else {
        onUpdateDashCardColumnSettings(id, getColumnKey(selectedColumn), {
          click_behavior: nextClickBehavior,
        });
      }

      // nextClickBehavior is `undefined` for drill-through menu
      const changedType =
        !!nextClickBehavior && nextClickBehavior.type !== clickBehavior?.type;

      if (changedType) {
        // move to next screen
        setTypeSelectorVisible(false);
      }
    },
    [
      dashcard,
      clickBehavior,
      selectedColumn,
      onUpdateDashCardColumnSettings,
      onUpdateDashCardVisualizationSettings,
    ],
  );

  const handleColumnSelected = useCallback(
    (column: DatasetColumn) => {
      const originalColumnVizSettings = getClickBehaviorForColumn(
        dashcard,
        column,
      );
      setSelectedColumn(column);
      setOriginalColumnVizSettings(originalColumnVizSettings);
    },
    [dashcard],
  );

  const handleUnsetSelectedColumn = useCallback(() => {
    if (!isValidClickBehavior) {
      handleChangeSettings(originalColumnVizSettings);
    }
    setOriginalColumnVizSettings(null);
    setSelectedColumn(null);
  }, [isValidClickBehavior, originalColumnVizSettings, handleChangeSettings]);

  const handleCancel = useCallback(() => {
    onReplaceAllDashCardVisualizationSettings(dashcard.id, originalVizSettings);
    hideClickBehaviorSidebar();
  }, [
    dashcard,
    originalVizSettings,
    hideClickBehaviorSidebar,
    onReplaceAllDashCardVisualizationSettings,
  ]);

  useMount(() => {
    if (shouldShowTypeSelector(clickBehavior)) {
      setTypeSelectorVisible(true);
    }
    if (dashcard) {
      setOriginalVizSettings(dashcard.visualization_settings);
    }
  });

  useEffect(() => {
    if (!previousDashcard) {
      return;
    }

    if (dashcard.id !== previousDashcard.id) {
      setOriginalVizSettings(dashcard.visualization_settings);
      if (hasSelectedColumn) {
        handleUnsetSelectedColumn();
      }
    }
  }, [
    dashcard,
    previousDashcard,
    hasSelectedColumn,
    handleUnsetSelectedColumn,
  ]);

  return (
    <Sidebar
      data-testid="click-behavior-sidebar"
      onClose={hideClickBehaviorSidebar}
      onCancel={handleCancel}
      isCloseDisabled={isCloseDisabled}
    >
      <ClickBehaviorSidebarHeader
        dashcard={dashcard}
        selectedColumn={selectedColumn}
        onUnsetColumn={handleUnsetSelectedColumn}
      />
      <div>
        <ClickBehaviorSidebarContent
          dashboard={dashboard}
          dashcard={dashcard}
          parameters={parameters}
          clickBehavior={clickBehavior}
          isTypeSelectorVisible={isTypeSelectorVisible}
          hasSelectedColumn={hasSelectedColumn}
          onColumnSelected={handleColumnSelected}
          onSettingsChange={handleChangeSettings}
          onTypeSelectorVisibilityChange={setTypeSelectorVisible}
        />
      </div>
    </Sidebar>
  );
}

export const ClickBehaviorSidebar = () => {
  const { dashboard, clickBehaviorSidebarDashcard } = useDashboardContext();

  if (!clickBehaviorSidebarDashcard || !dashboard) {
    return null;
  }

  return (
    <ClickBehaviorSidebarInner
      dashboard={dashboard}
      clickBehaviorSidebarDashcard={clickBehaviorSidebarDashcard}
    />
  );
};
