const { H } = cy;
import { SAMPLE_DB_ID } from "e2e/support/cypress_data";
import { SAMPLE_DATABASE } from "e2e/support/cypress_sample_database";

const { PEOPLE, PEOPLE_ID } = SAMPLE_DATABASE;

describe("scenarios > visualizations > maps", () => {
  beforeEach(() => {
    H.restore();
    cy.signInAsAdmin();
  });

  it("should display a pin map for a native query", () => {
    cy.signInAsNormalUser();
    // create a native query with lng/lat fields
    H.startNewNativeQuestion();
    H.NativeEditor.type(
      "select -80 as lng, 40 as lat union all select -120 as lng, 40 as lat",
    );
    cy.findByTestId("native-query-editor-container").icon("play").click();

    // switch to a pin map visualization
    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.contains("Visualization").click();
    cy.icon("pinmap").click();
    cy.findByTestId("Map-container").within(() => {
      cy.icon("gear").click();
    });

    toggleFieldSelectElement("Map type");
    H.popover().findByText("Pin map").click();

    // When the settings sidebar opens, both latitude and longitude selects are
    // open. That makes it difficult to select each in Cypress, so we click
    // inside both of them before reopening them one-by-one. :(
    // Please see: https://github.com/metabase/metabase/issues/18063#issuecomment-927836691
    ["Latitude field", "Longitude field"].map((field) =>
      H.leftSidebar().within(() => {
        toggleFieldSelectElement(field);
      }),
    );

    // select both columns
    H.leftSidebar().within(() => {
      toggleFieldSelectElement("Latitude field");
    });
    H.popover().findByText("LAT").click();

    H.leftSidebar().within(() => {
      toggleFieldSelectElement("Longitude field");
    });
    H.popover().findByText("LNG").click();

    // check that a map appears
    cy.get(".leaflet-container");
  });

  it("should suggest map visualization regardless of the first column type (metabase#14254)", () => {
    H.createNativeQuestion(
      {
        name: "14254",
        native: {
          query:
            'SELECT "PUBLIC"."PEOPLE"."LONGITUDE" AS "LONGITUDE", "PUBLIC"."PEOPLE"."LATITUDE" AS "LATITUDE", "PUBLIC"."PEOPLE"."CITY" AS "CITY"\nFROM "PUBLIC"."PEOPLE"\nLIMIT 10',
          "template-tags": {},
        },
        display: "map",
        visualization_settings: {
          "map.region": "us_states",
          "map.type": "pin",
          "map.latitude_column": "LATITUDE",
          "map.longitude_column": "LONGITUDE",
        },
      },
      { visitQuestion: true },
    );

    cy.button("Visualization").click();
    cy.findByTestId("display-options-sensible").as("sensibleOptions");

    cy.get("@sensibleOptions").within(() => {
      cy.findByText("Map").should("be.visible");
    });
  });

  it("should not assign the full name of the state as the filter value on a drill-through (metabase#14650)", () => {
    cy.intercept("/app/assets/geojson/**").as("geojson");
    H.visitQuestionAdhoc({
      dataset_query: {
        database: SAMPLE_DB_ID,
        query: {
          "source-table": PEOPLE_ID,
          aggregation: [["count"]],
          breakout: [["field", PEOPLE.STATE, null]],
        },
        type: "query",
      },
      display: "map",
      visualization_settings: {
        "map.type": "region",
        "map.region": "us_states",
      },
    });

    cy.wait("@geojson");

    cy.get(".CardVisualization svg path").eq(22).as("texas");

    cy.get("@texas").should("be.visible");

    // hover to see the tooltip
    cy.get("@texas").trigger("mousemove");

    // check tooltip content
    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText("State:"); // column name key
    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText("Texas"); // feature name as value

    // open drill-through menu and drill within it
    cy.get("@texas").click();
    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText(/See these People/i).click();

    cy.log("Reported as a regression since v0.37.0");
    cy.wait("@dataset").then((xhr) => {
      expect(xhr.request.body.query.filter).not.to.contain("Texas");
    });
    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText("State is TX");
    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText("171 Olive Oyle Lane"); // Address in the first row
  });

  it("should display a pins when a breakout column sets a base-type (metabase#59984)", () => {
    cy.intercept("/api/tiles/**").as("tiles");

    H.visitQuestionAdhoc({
      display: "map",
      dataset_query: {
        database: SAMPLE_DB_ID,
        type: "query",
        query: {
          "source-table": PEOPLE_ID,
          aggregation: ["count"],
          breakout: [
            [
              "field",
              PEOPLE.LONGITUDE,
              {
                "base-type": "type/Float",
              },
            ],
            [
              "field",
              PEOPLE.LATITUDE,
              {
                "base-type": "type/Float",
              },
            ],
          ],
        },
      },
      visualization_settings: {
        "map.type": "pin",
        "map.latitude_column": "LATITUDE",
        "map.longitude_column": "LONGITUDE",
      },
    });

    // this should not create a 400 error
    cy.wait("@tiles").then((xhr) => {
      expect(xhr.response.statusCode).to.equal(200);
    });
  });

  it("should display a tooltip for a grid map without a metric column (metabase#17940)", () => {
    H.visitQuestionAdhoc({
      display: "map",
      dataset_query: {
        database: SAMPLE_DB_ID,
        type: "query",
        query: {
          "source-table": PEOPLE_ID,
          breakout: [
            [
              "field",
              PEOPLE.LONGITUDE,
              {
                binning: {
                  strategy: "default",
                },
              },
            ],
            [
              "field",
              PEOPLE.LATITUDE,
              {
                binning: {
                  strategy: "default",
                },
              },
            ],
          ],
          limit: 1,
        },
      },
      visualization_settings: {
        "map.type": "grid",
        "table.pivot_column": "LATITUDE",
        "table.cell_column": "LONGITUDE",
      },
    });

    cy.get(".leaflet-interactive").trigger("mousemove");

    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText("Latitude: 10°:");
    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText("Longitude: 10°:");
    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText("1");
  });

  it("should render grid map visualization for native questions (metabase#8362)", () => {
    H.visitQuestionAdhoc({
      dataset_query: {
        type: "native",
        native: {
          query: `
              select 20 as "Latitude", -110 as "Longitude", 1 as "metric" union all
              select 70 as "Latitude", -170 as "Longitude", 5 as "metric"
            `,
          "template-tags": {},
        },
        database: SAMPLE_DB_ID,
      },
      display: "map",
      visualization_settings: {
        "map.type": "grid",
        "map.latitude_column": "Latitude",
        "map.longitude_column": "Longitude",
        "map.metric_column": "metric",
      },
    });

    // Ensure chart is rendered
    cy.get(".leaflet-interactive");

    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText("Visualization").click();

    // Ensure the Map visualization is sensible
    cy.findByTestId("display-options-sensible").as("sensibleOptions");

    cy.get("@sensibleOptions").within(() => {
      cy.findByTestId("Map-button").should("be.visible");
    });
  });

  describe(
    "Pin Map brush filters",
    { viewportWidth: 1280, viewportHeight: 800 },
    () => {
      function pinMapSelectRegion(
        x,
        y,
        moveX,
        moveY,
        visualization_settings = {
          "map.center_latitude": 0,
          "map.center_longitude": 0,
          "map.zoom": 0,
          "map.type": "pin",
          "map.latitude_column": "LATITUDE",
          "map.longitude_column": "LONGITUDE",
        },
      ) {
        H.visitQuestionAdhoc({
          dataset_query: {
            type: "query",
            database: SAMPLE_DB_ID,
            query: {
              "source-table": PEOPLE_ID,
            },
          },
          display: "map",
          visualization_settings,
        });

        cy.get(".CardVisualization").realHover();
        cy.findByTestId("visualization-root")
          .findByText("Draw box to filter")
          .click();

        cy.findByTestId("visualization-root")
          .realMouseDown({ x, y })
          .realMouseMove(moveX, moveY)
          .realMouseUp();

        cy.wait("@dataset");
      }

      it("should apply brush filters by dragging map", () => {
        pinMapSelectRegion(500, 500, 600, 600, {
          "map.region": "us_states",
          "map.type": "pin",
          "map.latitude_column": "LATITUDE",
          "map.longitude_column": "LONGITUDE",
        });
        cy.get(".CardVisualization").should("exist");
        // selecting area at the map provides different filter values, so the simplified assertion is used
        cy.findAllByTestId("filter-pill").should("have.length", 1);
      });

      it("should apply brush filters by dragging map when zoomed out (metabase#41056)", () => {
        pinMapSelectRegion(250, 150, 500, 250);
        cy.get(".CardVisualization").should("exist");
        cy.findAllByTestId("filter-pill").should("have.length", 1);
      });

      it("should handle brush filters that select zero data points (metabase#41056)", () => {
        pinMapSelectRegion(10, 10, 20, 20);
        cy.get(".CardVisualization").should("not.exist");
        cy.findByTestId("question-row-count").findByText("Showing 0 rows");
        cy.findAllByTestId("filter-pill").should("have.length", 1);
      });

      it("should handle brush filters that exceed 360 deg of longitude (metabase#41056)", () => {
        pinMapSelectRegion(10, 10, 1270, 600);
        cy.get(".CardVisualization").should("exist");
        cy.findByTestId("question-row-count").findByText(
          "Showing first 2,000 rows",
        );
        cy.findAllByTestId("filter-pill")
          .should("have.length", 1)
          .contains("Longitude is between -180 and 180");
      });

      it("should handle brush filters that cross the 180th meridian (metabase#41056)", () => {
        pinMapSelectRegion(100, 100, 200, 200);

        cy.get(".CardVisualization").should("exist");
        cy.findByTestId("question-row-count").findByText("Showing 9 rows");

        // Exact value for these longitude bounds is not important.
        const lngRegex = /\d+(\.\d+)?/.source;

        cy.findAllByTestId("filter-pill")
          .should("have.length", 1)
          .contains(
            new RegExp(
              `(Latitude is between .*) and Longitude is between ${lngRegex} and 180` +
                ` or \\1 and Longitude is between -180 and -${lngRegex}`,
            ),
          );
      });
    },
  );
});

function toggleFieldSelectElement(field) {
  return cy.get(`[data-field-title="${field}"]`).within(() => {
    cy.findByTestId("chart-setting-select").click();
  });
}
