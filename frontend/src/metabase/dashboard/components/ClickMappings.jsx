/* eslint-disable react/prop-types */
import cx from "classnames";
import { assocIn, dissocIn, getIn } from "icepick";
import { Component } from "react";
import { t } from "ttag";
import _ from "underscore";

import Select from "metabase/common/components/Select";
import CS from "metabase/css/core/index.css";
import { getDashcardData, getParameters } from "metabase/dashboard/selectors";
import { isPivotGroupColumn } from "metabase/lib/data_grid";
import { connect } from "metabase/lib/redux";
import MetabaseSettings from "metabase/lib/settings";
import { loadMetadataForCard } from "metabase/questions/actions";
import { getMetadata } from "metabase/selectors/metadata";
import { GTAPApi } from "metabase/services";
import { Flex, Icon } from "metabase/ui";
import * as Lib from "metabase-lib";
import Question from "metabase-lib/v1/Question";
import {
  getTargetsForDashboard,
  getTargetsForQuestion,
} from "metabase-lib/v1/parameters/utils/click-behavior";

import S from "./ClickMappings.module.css";

class ClickMappings extends Component {
  render() {
    const { setTargets, unsetTargets, question } = this.props;
    const sourceOptions = {
      ...this.props.sourceOptions,
      userAttribute: this.props.userAttributes,
    };

    const unsetTargetsWithSourceOptions = _.chain(unsetTargets)
      .map((target) => ({
        target,
        sourceOptions: _.chain(sourceOptions)
          .mapObject((sources, sourceType) =>
            sources
              .filter((source) => {
                const sourceFilter = target.sourceFilters[sourceType];

                return sourceFilter(source, question);
              })
              .map(getSourceOption[sourceType]),
          )
          .pairs()
          .filter(([, sources]) => sources.length > 0)
          .object()
          .value(),
      }))
      .filter(({ sourceOptions }) => Object.keys(sourceOptions).length > 0)
      .value();

    if (unsetTargetsWithSourceOptions.length === 0 && setTargets.length === 0) {
      return (
        <p
          className={cx(CS.textCentered, CS.textMedium)}
        >{t`No available targets`}</p>
      );
    }
    return (
      <div data-testid="click-mappings">
        <div>
          {setTargets.map((target) => {
            return (
              <TargetWithSource
                key={target.id}
                targetName={this.getTargetName()}
                target={target}
                {...this.props}
              />
            );
          })}
        </div>
        {unsetTargetsWithSourceOptions.length > 0 && (
          <div>
            <p className={cx(CS.mb2, CS.textMedium)}>
              {this.getTargetsHeading(setTargets)}
            </p>
            <div data-testid="unset-click-mappings">
              {unsetTargetsWithSourceOptions.map(
                ({ target, sourceOptions }) => (
                  <TargetWithoutSource
                    key={target.id}
                    target={target}
                    {...this.props}
                    sourceOptions={sourceOptions}
                  />
                ),
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  getTargetName() {
    const objectType = clickTargetObjectType(this.props.object);
    return { dashboard: t`filter`, native: t`variable`, gui: t`column` }[
      objectType
    ];
  }

  getTargetsHeading(setTargets) {
    const objectType = clickTargetObjectType(this.props.object);
    if (objectType === "dashboard") {
      return setTargets.length > 0
        ? t`Other available filters`
        : t`Available filters`;
    }
    if (objectType === "native") {
      return setTargets.length > 0
        ? t`Other available variables`
        : t`Available variables`;
    }
    if (objectType === "gui") {
      return setTargets.length > 0
        ? t`Other available columns`
        : t`Available columns`;
    }
    return "Unknown";
  }
}

export const ClickMappingsConnected = _.compose(
  loadQuestionMetadata((state, props) =>
    props.isDashboard ? null : props.object,
  ),
  withUserAttributes,
  connect((state, props) => {
    const { object, isDashboard, dashcard, clickBehavior } = props;
    let parameters = getParameters(state, props);
    const metadata = getMetadata(state);
    const dashcardData = getDashcardData(state, dashcard.id);
    const question = new Question(dashcard.card, metadata);

    if (props.excludeParametersSources) {
      // Remove parameters as possible sources.
      // We still include any that were already in use prior to this code change.
      const parametersUsedAsSources = Object.values(
        clickBehavior.parameterMapping || {},
      )
        .filter((mapping) => getIn(mapping, ["source", "type"]) === "parameter")
        .map((mapping) => mapping.source.id);
      parameters = parameters.filter((p) => {
        return parametersUsedAsSources.includes(p.id);
      });
    }

    const [setTargets, unsetTargets] = _.partition(
      isDashboard
        ? getTargetsForDashboard(object, dashcard)
        : getTargetsForQuestion(object),
      ({ id }) =>
        getIn(clickBehavior, ["parameterMapping", id, "source"]) != null,
    );

    const availableColumns =
      Object.values(dashcardData).flatMap((dataset) => dataset.data.cols) ?? [];

    const sourceOptions = {
      column: availableColumns.filter(isMappableColumn),
      parameter: parameters,
    };
    return { setTargets, unsetTargets, sourceOptions, question };
  }),
)(ClickMappings);

const getKeyForSource = (o) => (o.type == null ? null : `${o.type}-${o.id}`);
const getSourceOption = {
  column: (c) => ({ type: "column", id: c.name, name: c.display_name }),
  parameter: (p) => ({ type: "parameter", id: p.id, name: p.name }),
  userAttribute: (name) => ({ type: "userAttribute", name, id: name }),
};

function TargetWithoutSource({
  target,
  sourceOptions,
  clickBehavior,
  updateSettings,
}) {
  const { id, name, type } = target;

  return (
    <Select
      key={id}
      triggerElement={
        <Flex
          className={S.TargetTrigger}
          p="sm"
          mb="sm"
          fw="bold"
          w="100%"
          data-testid="click-target-column"
        >
          {name}
        </Flex>
      }
      value={null}
      sections={Object.entries(sourceOptions).map(([sourceType, items]) => ({
        name: {
          parameter: t`Dashboard filters`,
          column: t`Columns`,
          userAttribute: t`User attributes`,
        }[sourceType],
        items,
      }))}
      optionValueFn={getKeyForSource}
      optionNameFn={(o) => (o.type == null ? t`None` : o.name)}
      onChange={({ target: { value } }) => {
        updateSettings(
          assocIn(clickBehavior, ["parameterMapping", id], {
            source: Object.values(sourceOptions)
              .flat()
              .find((o) => getKeyForSource(o) === value),
            target: target.target,
            id,
            type,
          }),
        );
      }}
    />
  );
}

function TargetWithSource({
  target,
  targetName,
  clickBehavior,
  updateSettings,
}) {
  const { name, id } = target;
  const source =
    getIn(clickBehavior, ["parameterMapping", id, "source"]) || null;
  return (
    <div className={CS.mb2}>
      <div
        className={cx(
          CS.bordered,
          CS.rounded,
          CS.p2,
          CS.textMedium,
          CS.flex,
          CS.alignCenter,
        )}
        // eslint-disable-next-line no-color-literals
        style={{ borderColor: "#E2E4E8" }}
      >
        <svg
          width="12"
          height="38"
          viewBox="0 0 12 38"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ marginLeft: 8, marginRight: 8 }}
        >
          <g opacity="0.6">
            <path
              d="M9 32C9 33.6569 7.65685 35 6 35C4.34315 35 3 33.6569 3 32C3 30.3431 4.34315 29 6 29C7.65685 29 9 30.3431 9 32Z"
              // eslint-disable-next-line no-color-literals
              fill="#509EE3"
            />
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12 6C12 8.973 9.83771 11.441 7 11.917V26.083C9.83771 26.559 12 29.027 12 32C12 35.3137 9.31371 38 6 38C2.68629 38 0 35.3137 0 32C0 29.027 2.16229 26.559 5 26.083V11.917C2.16229 11.441 0 8.973 0 6C0 2.68629 2.68629 0 6 0C9.31371 0 12 2.68629 12 6ZM6 10C8.20914 10 10 8.20914 10 6C10 3.79086 8.20914 2 6 2C3.79086 2 2 3.79086 2 6C2 8.20914 3.79086 10 6 10ZM6 36C8.20914 36 10 34.2091 10 32C10 29.7909 8.20914 28 6 28C3.79086 28 2 29.7909 2 32C2 34.2091 3.79086 36 6 36Z"
              // eslint-disable-next-line no-color-literals
              fill="#509EE3"
            />
          </g>
        </svg>
        <div>
          <div>
            <span className={cx(CS.textBold, CS.textDark)}>{source.name}</span>{" "}
            {
              {
                column: t`column`,
                parameter: t`filter`,
                userAttribute: t`user attribute`,
              }[source.type]
            }
          </div>
          <div style={{ marginTop: 9 }}>
            <span className={cx(CS.textBrand, CS.textBold)}>{name}</span>{" "}
            {targetName}
          </div>
        </div>
        <div
          className={cx(CS.cursorPointer, CS.mlAuto)}
          onClick={() =>
            updateSettings(dissocIn(clickBehavior, ["parameterMapping", id]))
          }
        >
          <Icon name="close" size={12} />
        </div>
      </div>
    </div>
  );
}

/**
 * TODO: Extract this to a more general HOC. It can probably also take care of withTableMetadataLoaded.
 *
 * @deprecated HOCs are deprecated
 */
function loadQuestionMetadata(getQuestion) {
  return (ComposedComponent) => {
    class MetadataLoader extends Component {
      componentDidMount() {
        if (this.props.question) {
          this.fetch();
        }
      }

      componentDidUpdate({ question: prevQuestion }) {
        const { question } = this.props;
        if (question != null && question.id !== (prevQuestion || {}).id) {
          this.fetch();
        }
      }

      fetch() {
        const { question, loadMetadataForCard } = this.props;
        if (question) {
          loadMetadataForCard(question.card());
        }
      }

      render() {
        const { question, metadata, ...rest } = this.props;
        return <ComposedComponent {...rest} />;
      }
    }

    return connect(
      (state, props) => ({
        question: getQuestion && getQuestion(state, props),
      }),
      { loadMetadataForCard },
    )(MetadataLoader);
  };
}

export function withUserAttributes(ComposedComponent) {
  return class WithUserAttributes extends Component {
    state = { userAttributes: [] };

    async componentDidMount() {
      if (MetabaseSettings.sandboxingEnabled()) {
        this.setState({ userAttributes: await GTAPApi.attributes() });
      }
    }

    render() {
      return (
        <ComposedComponent
          {...this.props}
          userAttributes={this.state.userAttributes}
        />
      );
    }
  };
}

export function isMappableColumn(column) {
  // Pivot tables have a column in the result set that shouldn't be displayed.
  return !isPivotGroupColumn(column);
}

export function clickTargetObjectType(object) {
  if (!(object instanceof Question)) {
    return "dashboard";
  }

  const query = object.query();
  const { isNative } = Lib.queryDisplayInfo(query);

  return isNative ? "native" : "gui";
}
