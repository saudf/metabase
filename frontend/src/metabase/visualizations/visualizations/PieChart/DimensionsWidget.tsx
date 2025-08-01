import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
} from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { type MutableRefObject, useState } from "react";
import { t } from "ttag";

import { Sortable } from "metabase/common/components/Sortable";
import GrabberS from "metabase/css/components/grabber.module.css";
import { Button, Text } from "metabase/ui";
import { ChartSettingFieldPicker } from "metabase/visualizations/components/settings/ChartSettingFieldPicker";
import { getOptionFromColumn } from "metabase/visualizations/lib/settings/utils";
import { getPieDimensions } from "metabase/visualizations/shared/settings/pie";
import type { ComputedVisualizationSettings } from "metabase/visualizations/types";
import { isDimension } from "metabase-lib/v1/types/utils/isa";
import type { RawSeries } from "metabase-types/api";

import Styles from "./DimensionsWidget.module.css";
import { PieRowsPicker } from "./PieRowsPicker";

function DimensionPicker({
  value,
  options,
  showDragHandle,
  dragHandleRef,
  dragHandleListeners,
  onChange,
  onRemove,
}: {
  value: string | undefined;
  options: { name: string; value: string }[];
  showDragHandle: boolean;
  dragHandleRef?: MutableRefObject<HTMLElement | null>;
  dragHandleListeners?: SyntheticListenerMap;
  onChange?: (value: string) => void;
  onRemove?: (() => void) | undefined;
}) {
  return (
    <ChartSettingFieldPicker
      value={value}
      options={options}
      columnHasSettings={() => false}
      onChange={onChange}
      onRemove={onRemove}
      showColorPicker={false}
      showColumnSetting={false}
      className={Styles.dimensionPicker}
      colors={undefined}
      series={undefined}
      columns={undefined}
      onShowWidget={() => {}}
      onChangeSeriesColor={() => {}}
      showDragHandle={showDragHandle}
      dragHandleListeners={dragHandleListeners}
      dragHandleRef={dragHandleRef}
    />
  );
}

// eslint-disable-next-line ttag/no-module-declaration -- see metabase#55045
const BREAKOUT_TITLE = t`Breakout`;
// eslint-disable-next-line ttag/no-module-declaration -- see metabase#55045
const INNER_RING_TITLE = t`Inner Ring`;
// eslint-disable-next-line ttag/no-module-declaration -- see metabase#55045
const MIDDLE_RING_TITLE = t`Middle Ring`;
// eslint-disable-next-line ttag/no-module-declaration -- see metabase#55045
const OUTER_RING_TITLE = t`Outer Ring`;

const SINGLE_RING_SETTING_TITLES = [BREAKOUT_TITLE];
const TWO_RING_SETTING_TITLES = [INNER_RING_TITLE, OUTER_RING_TITLE];
const THREE_RING_SETTING_TITLES = [
  INNER_RING_TITLE,
  MIDDLE_RING_TITLE,
  OUTER_RING_TITLE,
];

export function DimensionsWidget({
  rawSeries,
  settings,
  onChangeSettings,
  onShowWidget,
}: {
  rawSeries: RawSeries;
  settings: ComputedVisualizationSettings;
  onChangeSettings: (newSettings: ComputedVisualizationSettings) => void;
  onShowWidget: (widget: any, ref: any) => void;
}) {
  // Dimension settings
  const [dimensions, setDimensions] = useState<(string | undefined)[]>(() => [
    ...getPieDimensions(settings),
  ]);

  const actualRingCount = dimensions.filter((d) => d != null).length;
  const dimensionTitles =
    actualRingCount === 1
      ? SINGLE_RING_SETTING_TITLES
      : actualRingCount === 2
        ? TWO_RING_SETTING_TITLES
        : THREE_RING_SETTING_TITLES;

  const updateDimensions = (newDimensions: (string | undefined)[]) => {
    setDimensions(newDimensions);
    onChangeSettings({
      "pie.dimension": newDimensions.filter((d) => d != null) as string[],
    });
  };

  const onChangeDimension = (index: number) => (newValue: string) => {
    const newDimensions = [...dimensions];
    newDimensions[index] = newValue;

    updateDimensions(newDimensions);
  };

  const onRemove = (index: number) => () => {
    const newDimensions = [...dimensions];
    newDimensions.splice(index, 1);

    updateDimensions(newDimensions);
  };

  // Dropdown options
  const dimensionOptions = rawSeries[0].data.cols
    .filter(isDimension)
    .map(getOptionFromColumn);

  const getFilteredOptions = (index: number) =>
    dimensionOptions.filter(
      (opt) =>
        opt.value === dimensions[index] || !dimensions.includes(opt.value),
    );

  // Drag and drop
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 15 },
  });
  const [draggedDimensionIndex, setDraggedDimensionIndex] = useState<number>();

  const onDragStart = (event: DragStartEvent) => {
    document.body.classList.add(GrabberS.grabbing);

    setDraggedDimensionIndex(
      dimensions.findIndex((d) => d === String(event.active.id)),
    );
  };

  const onDragEnd = (event: DragEndEvent) => {
    document.body.classList.remove(GrabberS.grabbing);

    setDraggedDimensionIndex(undefined);

    const over = event.over;
    if (over == null) {
      return;
    }
    const sourceIndex = dimensions.findIndex((d) => d === event.active.id);
    const destIndex = dimensions.findIndex((d) => d === over.id);

    if (sourceIndex === -1 || destIndex === -1) {
      return;
    }
    updateDimensions(arrayMove(dimensions, sourceIndex, destIndex));
  };

  return (
    <>
      <DndContext
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        modifiers={[restrictToVerticalAxis]}
        sensors={[pointerSensor]}
      >
        <SortableContext
          items={(dimensions.filter((d) => d != null) as string[]).map((d) => ({
            id: d,
          }))}
          strategy={verticalListSortingStrategy}
        >
          {dimensions.map((dimension, index) => (
            <div key={`dimension-${index}`}>
              <Text fw="bold" mb="sm">
                {dimensionTitles[index]}
              </Text>
              <Sortable
                key={String(dimension)}
                id={String(dimension)}
                disabled={dimensions.length === 1 || dimension == null}
                draggingStyle={{ opacity: 0.5 }}
              >
                {({ dragHandleRef, dragHandleListeners }) => (
                  <DimensionPicker
                    key={dimension}
                    value={dimension}
                    onChange={onChangeDimension(index)}
                    onRemove={
                      dimensions.length > 1 ? onRemove(index) : undefined
                    }
                    options={getFilteredOptions(index)}
                    showDragHandle={dimensions.length > 1 && dimension != null}
                    dragHandleRef={dragHandleRef}
                    dragHandleListeners={dragHandleListeners}
                  />
                )}
              </Sortable>
              {index === 0 && (
                <PieRowsPicker
                  rawSeries={rawSeries}
                  settings={settings}
                  onChangeSettings={onChangeSettings}
                  onShowWidget={onShowWidget}
                  numRings={dimensions.filter((d) => d != null).length}
                />
              )}
            </div>
          ))}
          <DragOverlay>
            {draggedDimensionIndex != null ? (
              <DimensionPicker
                value={dimensions[draggedDimensionIndex]}
                options={getFilteredOptions(draggedDimensionIndex)}
                onRemove={() => {}}
                showDragHandle
              />
            ) : null}
          </DragOverlay>
        </SortableContext>
      </DndContext>
      {dimensions.length < 3 &&
        dimensions[dimensions.length - 1] != null &&
        getFilteredOptions(dimensions.length).length > 0 && (
          <Button
            variant="subtle"
            onClick={() => setDimensions([...dimensions, undefined])}
          >{t`Add Ring`}</Button>
        )}
    </>
  );
}
