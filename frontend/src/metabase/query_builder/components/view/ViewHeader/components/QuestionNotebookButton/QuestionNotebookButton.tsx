import { t } from "ttag";

import { useRegisterShortcut } from "metabase/palette/hooks/useRegisterShortcut";
import { Button, Icon } from "metabase/ui";
import * as Lib from "metabase-lib";
import type Question from "metabase-lib/v1/Question";
import type { DatasetEditorTab, QueryBuilderMode } from "metabase-types/store";

import ViewTitleHeaderS from "../../ViewTitleHeader.module.css";

type QuestionNotebookButtonProps = {
  isShowingNotebook: boolean;
  setQueryBuilderMode: (
    mode: QueryBuilderMode,
    opts?: {
      shouldUpdateUrl?: boolean;
      datasetEditorTab?: DatasetEditorTab;
    },
  ) => void;
};

export function QuestionNotebookButton({
  isShowingNotebook,
  setQueryBuilderMode,
}: QuestionNotebookButtonProps) {
  useRegisterShortcut(
    [
      {
        id: "query-builder-toggle-notebook-editor",
        perform: () =>
          setQueryBuilderMode(isShowingNotebook ? "view" : "notebook"),
      },
    ],
    [isShowingNotebook],
  );
  return (
    <Button
      data-testid="notebook-button"
      className={ViewTitleHeaderS.NotebookButton}
      leftSection={
        isShowingNotebook ? (
          <Icon name="lineandbar" />
        ) : (
          <Icon name="pencil_lines" />
        )
      }
      onClick={() =>
        setQueryBuilderMode(isShowingNotebook ? "view" : "notebook")
      }
    >
      {isShowingNotebook ? t`Visualization` : t`Editor`}
    </Button>
  );
}

QuestionNotebookButton.shouldRender = ({
  question,
  isActionListVisible,
  isBrandNew = false,
}: {
  question: Question;
  isActionListVisible: boolean;
  isBrandNew?: boolean;
}) => {
  const { isEditable, isNative } = Lib.queryDisplayInfo(question.query());
  return (
    !isNative &&
    isEditable &&
    isActionListVisible &&
    !question.isArchived() &&
    !isBrandNew
  );
};
