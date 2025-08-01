const { H } = cy;
import { SAMPLE_DB_ID, USER_GROUPS } from "e2e/support/cypress_data";
import { SAMPLE_DATABASE } from "e2e/support/cypress_sample_database";
import { ORDERS_QUESTION_ID } from "e2e/support/cypress_sample_instance_data";

const { ORDERS_ID } = SAMPLE_DATABASE;
const { ALL_USERS_GROUP, COLLECTION_GROUP } = USER_GROUPS;

const DATA_ACCESS_PERM_IDX = 0;
const CREATE_QUERIES_PERM_IDX = 1;
const DOWNLOAD_PERM_IDX = 2;

// EDITOR RELATED TESTS

describe("scenarios > admin > permissions > view data > blocked", () => {
  beforeEach(() => {
    H.restore();
    cy.signInAsAdmin();
    H.activateToken("pro-self-hosted");
  });

  const g = "All Users";

  it("should allow saving 'blocked' and disable create queries dropdown when set", () => {
    cy.visit(
      `/admin/permissions/data/database/${SAMPLE_DB_ID}/schema/PUBLIC/table/${ORDERS_ID}`, // table level
    );

    H.assertPermissionForItem(g, DATA_ACCESS_PERM_IDX, "Can view", false);
    H.assertPermissionForItem(g, CREATE_QUERIES_PERM_IDX, "No", false);
    H.assertPermissionForItem(g, DOWNLOAD_PERM_IDX, "1 million rows", false);

    H.modifyPermission(g, DATA_ACCESS_PERM_IDX, "Blocked");

    H.assertSameBeforeAndAfterSave(() => {
      H.assertPermissionForItem(g, DATA_ACCESS_PERM_IDX, "Blocked", false);
      H.assertPermissionForItem(g, CREATE_QUERIES_PERM_IDX, "No", true);
      H.assertPermissionForItem(g, DOWNLOAD_PERM_IDX, "No", true);
    });

    cy.log(
      "assert that user properly sees native query warning related to table level blocking",
    );
    // eslint-disable-next-line no-unsafe-element-filtering
    H.getPermissionRowPermissions("All Users")
      .eq(DATA_ACCESS_PERM_IDX)
      .findByLabelText("warning icon")
      .realHover();

    cy.findByRole("tooltip")
      .findByText(
        /Groups with a database, schema, or table set to Blocked can't view native queries on this database/,
      )
      .should("exist");

    cy.visit(`/admin/permissions/data/database/${SAMPLE_DB_ID}`); // database level

    H.assertPermissionForItem(g, DATA_ACCESS_PERM_IDX, "Granular", false);
    H.assertPermissionForItem(g, CREATE_QUERIES_PERM_IDX, "No", false);
    H.assertPermissionForItem(g, DOWNLOAD_PERM_IDX, "Granular", false);

    H.modifyPermission(g, DATA_ACCESS_PERM_IDX, "Blocked");

    H.assertSameBeforeAndAfterSave(() => {
      H.assertPermissionForItem(g, DATA_ACCESS_PERM_IDX, "Blocked", false);
      H.assertPermissionForItem(g, CREATE_QUERIES_PERM_IDX, "No", true);
      H.assertPermissionForItem(g, DOWNLOAD_PERM_IDX, "No", true);
    });
  });

  it("should prevent user from upgrading db/schema create query permissions if a child schema/table contains blocked permissions", () => {
    cy.visit(
      `/admin/permissions/data/group/${ALL_USERS_GROUP}/database/${SAMPLE_DB_ID}`,
    ); // table level

    cy.log("ensure that modify tables do not affect other rows");
    // this is the test is admittedly a little opaque, we're trying to test that
    // the calculation that upgrades view data permissions does not apply to tables
    H.modifyPermission("Orders", DATA_ACCESS_PERM_IDX, "Blocked"); // add blocked to one table
    H.modifyPermission(
      "Products",
      CREATE_QUERIES_PERM_IDX,
      "Query builder only",
    ); // increase permissions of another table to trigger upgrade flow
    H.assertPermissionForItem("Orders", DATA_ACCESS_PERM_IDX, "Blocked"); // orders table should stay the same

    H.selectSidebarItem("All Users");
    H.assertPermissionForItem(
      "Sample Database",
      DATA_ACCESS_PERM_IDX,
      "Granular",
    );
    H.modifyPermission(
      "Sample Database",
      CREATE_QUERIES_PERM_IDX,
      "Query builder only",
    );

    H.modal()
      .should("exist")
      .within(() => {
        cy.findByText(
          "This will also set the View Data permission to “Can View” to allow this group to create queries. Okay?",
        ).should("exist");
        cy.findByText("Okay").click();
      });

    H.assertPermissionForItem(
      "Sample Database",
      DATA_ACCESS_PERM_IDX,
      "Can view",
    );
    H.assertPermissionForItem(
      "Sample Database",
      CREATE_QUERIES_PERM_IDX,
      "Query builder only",
    );
  });
});

describe("scenarios > admin > permissions > view data > granular", () => {
  beforeEach(() => {
    H.restore();
    cy.signInAsAdmin();
  });

  it("should not allow making permissions granular in the either database or group focused view", () => {
    cy.visit(`/admin/permissions/data/database/${SAMPLE_DB_ID}`);

    cy.get("main").findByText("View data").should("not.exist");

    cy.visit(`/admin/permissions/data/group/${ALL_USERS_GROUP}`);

    cy.get("main").findByText("View data").should("not.exist");
  });
});

describe("scenarios > admin > permissions > view data > granular", () => {
  beforeEach(() => {
    H.restore();
    cy.signInAsAdmin();
    H.activateToken("pro-self-hosted");
    cy.intercept("PUT", "/api/permissions/graph").as("saveGraph");
  });

  it("should allow making permissions granular in the database focused view", () => {
    cy.visit(`/admin/permissions/data/database/${SAMPLE_DB_ID}`);

    H.modifyPermission("All Users", DATA_ACCESS_PERM_IDX, "Granular");

    cy.url().should(
      "include",
      `/admin/permissions/data/group/${ALL_USERS_GROUP}/database/${SAMPLE_DB_ID}`,
    );

    makeOrdersSandboxed();

    H.selectSidebarItem("All Users");

    H.assertPermissionTable([
      ["Sample Database", "Granular", "No", "1 million rows", "No", "No"],
    ]);

    cy.button("Save changes").click();

    H.modal().within(() => {
      cy.findByText("Save permissions?").should("exist");
      cy.contains(
        "All Users will be given access to 1 table in Sample Database",
      ).should("exist");
      cy.button("Yes").click();
    });

    cy.wait("@saveGraph").then(({ response }) => {
      expect(response.statusCode).to.equal(200);
    });
  });

  it("should allow making permissions granular in the group focused view", () => {
    cy.visit(`/admin/permissions/data/group/${ALL_USERS_GROUP}`);

    H.modifyPermission("Sample Database", DATA_ACCESS_PERM_IDX, "Granular");

    cy.url().should(
      "include",
      `/admin/permissions/data/group/${ALL_USERS_GROUP}/database/${SAMPLE_DB_ID}`,
    );

    makeOrdersSandboxed();

    H.selectSidebarItem("All Users");

    H.assertPermissionTable([
      ["Sample Database", "Granular", "No", "1 million rows", "No", "No"],
    ]);

    cy.button("Save changes").click();

    H.modal().within(() => {
      cy.findByText("Save permissions?").should("exist");
      cy.contains(
        "All Users will be given access to 1 table in Sample Database",
      ).should("exist");
      cy.button("Yes").click();
    });

    cy.wait("@saveGraph").then(({ response }) => {
      expect(response.statusCode).to.equal(200);
    });
  });

  it("should infer parent permissions if all granular permissions are equal", () => {
    // TODO: this feature (not test) is broken when changing permissions for all schemas to the samve value

    cy.visit(`/admin/permissions/data/group/${ALL_USERS_GROUP}`);

    H.modifyPermission("Sample Database", DATA_ACCESS_PERM_IDX, "Granular");

    makeOrdersSandboxed();

    H.selectSidebarItem("All Users");

    H.assertPermissionTable([
      ["Sample Database", "Granular", "No", "1 million rows", "No", "No"],
    ]);

    cy.findByTestId("permission-table")
      .find("tbody > tr")
      .contains("Sample Database")
      .closest("a")
      .click();

    H.modifyPermission("Orders", DATA_ACCESS_PERM_IDX, "Can view");

    H.selectSidebarItem("All Users");

    H.assertPermissionTable([
      ["Sample Database", "Can view", "No", "1 million rows", "No", "No"],
    ]);
  });

  it("should preserve parent value for children when selecting granular for permissions available to child entities", () => {
    cy.visit(`/admin/permissions/data/group/${ALL_USERS_GROUP}`);

    H.modifyPermission("Sample Database", DATA_ACCESS_PERM_IDX, "Blocked");

    H.modifyPermission("Sample Database", DATA_ACCESS_PERM_IDX, "Granular");

    H.assertPermissionForItem("Orders", DATA_ACCESS_PERM_IDX, "Blocked");
  });
});

describe(
  "scenarios > admin > permissions > view data > impersonated",
  { tags: "@external" },
  () => {
    beforeEach(() => {
      H.restore("postgres-12");
      H.createTestRoles({ type: "postgres" });
      cy.signInAsAdmin();
      H.activateToken("pro-self-hosted");
    });

    it("should allow saving 'impersonated' permissions", () => {
      cy.visit(`/admin/permissions/data/group/${ALL_USERS_GROUP}`);

      // Check there is no Impersonated option on H2
      H.selectPermissionRow("Sample Database", DATA_ACCESS_PERM_IDX);
      H.popover().should("not.contain", "Impersonated");

      // Set impersonated access on Postgres database
      H.modifyPermission("QA Postgres12", DATA_ACCESS_PERM_IDX, "Impersonated");

      H.selectImpersonatedAttribute("role");
      H.saveImpersonationSettings();
      H.savePermissions();

      H.assertPermissionTable([
        ["Sample Database", "Can view", "No", "1 million rows", "No", "No"],
        ["QA Postgres12", "Impersonated", "No", "1 million rows", "No", "No"],
      ]);

      // Checking it shows the right state on the tables level
      cy.get("main").findByText("QA Postgres12").click();

      H.assertPermissionTable(
        [
          "Accounts",
          "Analytic Events",
          "Feedback",
          "Invoices",
          "Orders",
          "People",
          "Products",
          "Reviews",
        ].map((tableName) => [
          tableName,
          "Impersonated",
          "No",
          "1 million rows",
          "No",
          "No",
        ]),
      );

      // Return back to the database view
      cy.get("main").findByText("All Users group").click();

      // Edit impersonated permission
      H.modifyPermission(
        "QA Postgres12",
        DATA_ACCESS_PERM_IDX,
        "Edit Impersonated",
      );

      H.selectImpersonatedAttribute("attr_uid");
      H.saveImpersonationSettings();
      H.savePermissions();

      H.assertPermissionTable([
        ["Sample Database", "Can view", "No", "1 million rows", "No", "No"],
        ["QA Postgres12", "Impersonated", "No", "1 million rows", "No", "No"],
      ]);
    });

    it("should warn when All Users group has 'impersonated' access and the target group has unrestricted access", () => {
      cy.visit(`/admin/permissions/data/group/${COLLECTION_GROUP}`);

      H.modifyPermission("QA Postgres12", DATA_ACCESS_PERM_IDX, "Impersonated");

      // Warns that All Users group has greater access
      cy.findByRole("dialog").within(() => {
        cy.findByText(
          'Revoke access even though "All Users" has greater access?',
        );

        cy.findByText("Revoke access").click();
      });

      H.selectImpersonatedAttribute("role");
      H.saveImpersonationSettings();
      H.savePermissions();

      // eslint-disable-next-line no-unsafe-element-filtering
      H.getPermissionRowPermissions("QA Postgres12")
        .eq(DATA_ACCESS_PERM_IDX)
        .findByLabelText("warning icon")
        .realHover();

      H.tooltip().findByText(
        'The "All Users" group has a higher level of access than this, which will override this setting. You should limit or revoke the "All Users" group\'s access to this item.',
      );
    });

    it("allows switching to the granular access and update table permissions", () => {
      cy.visit(`/admin/permissions/data/group/${ALL_USERS_GROUP}`);

      H.modifyPermission("QA Postgres12", DATA_ACCESS_PERM_IDX, "Impersonated");

      H.selectImpersonatedAttribute("role");
      H.saveImpersonationSettings();
      H.savePermissions();

      H.modifyPermission("QA Postgres12", DATA_ACCESS_PERM_IDX, "Granular");

      // Resets table permissions from Impersonated to Can view
      H.assertPermissionTable(
        [
          "Accounts",
          "Analytic Events",
          "Feedback",
          "Invoices",
          "Orders",
          "People",
          "Products",
          "Reviews",
        ].map((tableName) => [
          tableName,
          "Can view",
          "No",
          "1 million rows",
          "No",
          "No",
        ]),
      );
      // Return back to the database view
      cy.get("main").findByText("All Users group").click();

      // On database level it got reset to Can view too
      H.assertPermissionTable([
        ["Sample Database", "Can view", "No", "1 million rows", "No", "No"],
        ["QA Postgres12", "Can view", "No", "1 million rows", "No", "No"],
      ]);
    });

    it("impersonation modal should be positioned behind the page leave confirmation modal", () => {
      cy.log("Try leaving the page");
      cy.visit(`/admin/permissions/data/group/${ALL_USERS_GROUP}`);

      H.modifyPermission("QA Postgres12", DATA_ACCESS_PERM_IDX, "Impersonated");

      H.selectImpersonatedAttribute("role");
      H.saveImpersonationSettings();

      H.modifyPermission(
        "QA Postgres12",
        DATA_ACCESS_PERM_IDX,
        "Edit Impersonated",
      );

      cy.findByRole("dialog").findByText("Edit settings").click();

      cy.log("Page leave confirmation should be on top");
      cy.findByTestId("leave-confirmation")
        .as("leaveConfirmation")
        .findByText("Discard your changes?")
        .should("be.visible");

      cy.log("Cancel page leave");
      cy.get("@leaveConfirmation").findByText("Cancel").click();

      cy.log("Ensure the impersonation modal is still open");
      cy.findByRole("dialog")
        .findByText("Map a user attribute to database roles")
        .should("be.visible");

      cy.log("Go to settings");
      cy.findByRole("dialog").findByText("Edit settings").click();
      cy.get("@leaveConfirmation").findByText("Discard changes").click();

      cy.focused().should("have.attr", "placeholder", "username");
    });

    it("should set unrestricted for children if database is set to impersonated before going granular", () => {
      cy.visit(`/admin/permissions/data/group/${ALL_USERS_GROUP}`);

      H.modifyPermission("QA Postgres12", DATA_ACCESS_PERM_IDX, "Impersonated");

      H.selectImpersonatedAttribute("role");
      H.saveImpersonationSettings();

      H.modifyPermission("Sample Database", DATA_ACCESS_PERM_IDX, "Granular");

      H.assertPermissionForItem("Orders", DATA_ACCESS_PERM_IDX, "Can view");
    });
  },
);

describe("scenarios > admin > permissions > view data > legacy no self-service", () => {
  beforeEach(() => {
    H.restore();
    cy.signInAsAdmin();
    H.activateToken("pro-self-hosted");
  });

  it("'no self service' should only be an option if it is the current value in the permissions graph", () => {
    // load the page like normal w/o legacy value in the graph
    // and test that it does not exist
    cy.visit(`/admin/permissions/data/group/${ALL_USERS_GROUP}`);

    H.selectPermissionRow("Sample Database", DATA_ACCESS_PERM_IDX);
    H.popover().should("not.contain", "No self-service (Deprecated)");

    H.selectPermissionRow("Sample Database", CREATE_QUERIES_PERM_IDX);
    H.isPermissionDisabled(CREATE_QUERIES_PERM_IDX, "No", false);

    // load the page w/ legacy value in the graph and test that it does exist
    cy.reload();
    cy.intercept("GET", `/api/permissions/graph/group/${ALL_USERS_GROUP}`, {
      statusCode: 200,
      body: {
        revision: 1,
        groups: {
          1: {
            1: {
              "view-data": "legacy-no-self-service",
              "create-queries": "no",
              download: { schemas: "full" },
            },
          },
        },
      },
    });

    H.assertPermissionTable([
      [
        "Sample Database",
        "No self-service (Deprecated)",
        "No",
        "1 million rows",
        "No",
        "No",
      ],
    ]);

    // User should not be able to modify Create queries permission while set to legacy-no-self-service
    H.isPermissionDisabled(CREATE_QUERIES_PERM_IDX, "No", true);

    H.modifyPermission("Sample Database", DATA_ACCESS_PERM_IDX, "Can view");

    H.modifyPermission(
      "Sample Database",
      CREATE_QUERIES_PERM_IDX,
      "Query builder and native",
    );

    H.modifyPermission(
      "Sample Database",
      DATA_ACCESS_PERM_IDX,
      "No self-service (Deprecated)",
    );

    // change something else so we can save
    H.modifyPermission("Sample Database", DOWNLOAD_PERM_IDX, "No");

    // User setting the value back to legacy-no-self-service should result in Create queries going back to No
    const finalExpectedRows = [
      [
        "Sample Database",
        "No self-service (Deprecated)",
        "No",
        "No",
        "No",
        "No",
      ],
    ];
    H.assertPermissionTable(finalExpectedRows);

    cy.intercept("PUT", "/api/permissions/graph").as("saveGraph");

    cy.button("Save changes").click();

    H.modal().within(() => {
      cy.findByText("Save permissions?");
      cy.button("Yes").click();
    });

    cy.wait("@saveGraph").then(({ response }) => {
      expect(response.statusCode).to.equal(200);
    });

    H.assertPermissionTable(finalExpectedRows);
  });
});

describe("scenarios > admin > permissions > view data > sandboxed", () => {
  beforeEach(() => {
    H.restore();
    cy.signInAsAdmin();
    H.activateToken("pro-self-hosted");
  });

  it("allows editing sandboxed access in the database focused view", () => {
    cy.visit(`/admin/permissions/data/database/${SAMPLE_DB_ID}`);

    // make sure that we have native permissions now so that we can validate that
    // permissions are droped to query builder only after we sandbox a table
    H.modifyPermission(
      "All Users",
      CREATE_QUERIES_PERM_IDX,
      "Query builder and native",
    );

    H.selectSidebarItem("Orders");

    H.modifyPermission(
      "All Users",
      DATA_ACCESS_PERM_IDX,
      "Row and column security",
    );

    H.modal().within(() => {
      cy.findByText(
        "Change access to this database to “Row and column security”?",
      );
      cy.button("Change").click();
    });

    cy.url().should(
      "include",
      `/admin/permissions/data/database/${SAMPLE_DB_ID}/schema/PUBLIC/table/${ORDERS_ID}/segmented/group/${ALL_USERS_GROUP}`,
    );
    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText("Configure row and column security for this table");
    cy.button("Save").should("be.disabled");

    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText("Pick a column").click();
    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText("User ID").click();

    cy.findByPlaceholderText("Pick a user attribute").click();
    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText("attr_uid").click();
    cy.button("Save").click();

    const expectedFinalPermissions = [
      [
        "Administrators",
        "Can view",
        "Query builder and native",
        "1 million rows",
        "Yes",
      ],
      // expect that the view data permissions has been automatically droped to query builder only
      [
        "All Users",
        "Row and column security",
        "Query builder only",
        "1 million rows",
        "No",
      ],
      ["collection", "Can view", "No", "1 million rows", "No"],
      ["data", "Can view", "Query builder and native", "1 million rows", "No"],
      ["nosql", "Can view", "Query builder only", "1 million rows", "No"],
      ["readonly", "Can view", "No", "1 million rows", "No"],
    ];
    H.assertPermissionTable(expectedFinalPermissions);

    H.modifyPermission(
      "All Users",
      DATA_ACCESS_PERM_IDX,
      "Edit row and column security",
    );

    cy.url().should(
      "include",
      `/admin/permissions/data/database/${SAMPLE_DB_ID}/schema/PUBLIC/table/${ORDERS_ID}/segmented/group/${ALL_USERS_GROUP}`,
    );
    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText("Configure row and column security for this table");

    cy.button("Save").click();
    // eslint-disable-next-line no-unscoped-text-selectors -- deprecated usage
    cy.findByText("Configure row and column security for this table").should(
      "not.exist",
    );

    cy.button("Save changes").click();

    H.assertPermissionTable(expectedFinalPermissions);
  });

  it("allows editing sandboxed access in the group focused view", () => {
    cy.intercept("PUT", "/api/permissions/graph").as("saveGraph");
    cy.visit(`/admin/permissions/data/group/${ALL_USERS_GROUP}`);

    // make sure that we have native permissions now so that we can validate that
    // permissions are droped to query builder only after we sandbox a table
    H.modifyPermission(
      "Sample Database",
      CREATE_QUERIES_PERM_IDX,
      "Query builder and native",
    );

    cy.get("a").contains("Sample Database").click();

    H.modifyPermission(
      "Orders",
      DATA_ACCESS_PERM_IDX,
      "Row and column security",
    );

    H.modal().within(() => {
      cy.findByText(
        "Change access to this database to “Row and column security”?",
      );
      cy.button("Change").click();
    });

    cy.url().should(
      "include",
      `/admin/permissions/data/group/${ALL_USERS_GROUP}/database/${SAMPLE_DB_ID}/schema/PUBLIC/${ORDERS_ID}/segmented`,
    );
    H.modal().within(() => {
      cy.findByText("Configure row and column security for this table");
      cy.button("Save").should("be.disabled");
      cy.findByText("Pick a column").click();
    });

    H.popover().findByText("User ID").click();
    H.modal().findByPlaceholderText("Pick a user attribute").click();
    H.popover().findByText("attr_uid").click();
    H.modal().button("Save").click();

    const expectedFinalPermissions = [
      ["Accounts", "Can view", "Query builder only", "1 million rows", "No"],
      [
        "Analytic Events",
        "Can view",
        "Query builder only",
        "1 million rows",
        "No",
      ],
      ["Feedback", "Can view", "Query builder only", "1 million rows", "No"],
      ["Invoices", "Can view", "Query builder only", "1 million rows", "No"],
      [
        "Orders",
        "Row and column security",
        "Query builder only",
        "1 million rows",
        "No",
      ],
      ["People", "Can view", "Query builder only", "1 million rows", "No"],
      ["Products", "Can view", "Query builder only", "1 million rows", "No"],
      ["Reviews", "Can view", "Query builder only", "1 million rows", "No"],
    ];

    H.assertPermissionTable(expectedFinalPermissions);

    H.modifyPermission(
      "Orders",
      DATA_ACCESS_PERM_IDX,
      "Edit row and column security",
    );

    cy.url().should(
      "include",
      `/admin/permissions/data/group/${ALL_USERS_GROUP}/database/${SAMPLE_DB_ID}/schema/PUBLIC/${ORDERS_ID}/segmented`,
    );

    H.modal().findByText("Configure row and column security for this table");

    cy.button("Save").click();

    H.modal().should("not.exist");

    cy.url().should(
      "include",
      `/admin/permissions/data/group/${ALL_USERS_GROUP}/database/${SAMPLE_DB_ID}/schema/PUBLIC`,
    );

    cy.button("Save changes").click();

    H.modal().within(() => {
      cy.findByText("Save permissions?").should("exist");
      cy.contains(
        "All Users will be given access to 1 table in Sample Database",
      ).should("exist");
      cy.button("Yes").click();
    });

    cy.wait("@saveGraph");

    // assertions that specifically targets metabase#37774. Should be able to reload with the schema in the URL and not error
    cy.url().should(
      "include",
      `/admin/permissions/data/group/${ALL_USERS_GROUP}/database/${SAMPLE_DB_ID}/schema/PUBLIC`,
    );
    cy.reload();

    H.assertPermissionTable(expectedFinalPermissions);
  });
});

describe("scenarios > admin > permissions > view data > reproductions", () => {
  it("should allow you to sandbox view permissions and also edit the create queries permissions and saving should persist both (metabase#46450)", () => {
    H.restore();
    cy.signInAsAdmin();
    H.activateToken("pro-self-hosted");

    cy.intercept("PUT", "/api/permissions/graph").as("saveGraph");
    cy.visit(`/admin/permissions/data/group/${ALL_USERS_GROUP}`);

    cy.get("a").contains("Sample Database").click();

    H.modifyPermission(
      "Orders",
      DATA_ACCESS_PERM_IDX,
      "Row and column security",
    );

    H.modal().within(() => {
      cy.findByText("Configure row and column security for this table");
      cy.button("Save").should("be.disabled");
      cy.findByText("Pick a column").click();
    });

    H.popover().findByText("User ID").click();
    H.modal().findByPlaceholderText("Pick a user attribute").click();
    H.popover().findByText("attr_uid").click();
    H.modal().button("Save").click();

    H.modifyPermission("Orders", CREATE_QUERIES_PERM_IDX, "Query builder only");

    H.savePermissions();

    cy.wait("@saveGraph").then(({ response }) => {
      expect(response.statusCode).to.equal(200);
    });

    H.assertPermissionForItem(
      "Orders",
      DATA_ACCESS_PERM_IDX,
      "Row and column security",
    );
    H.assertPermissionForItem(
      "Orders",
      CREATE_QUERIES_PERM_IDX,
      "Query builder only",
    );
  });

  it(
    "should allow you to impersonate view permissions and also edit the create queries permissions and saving should persist both (metabase#46450)",
    { tags: "@external" },
    () => {
      H.restore("postgres-12");
      H.createTestRoles({ type: "postgres" });
      cy.signInAsAdmin();
      H.activateToken("pro-self-hosted");

      cy.intercept("PUT", "/api/permissions/graph").as("saveGraph");

      cy.visit(`/admin/permissions/data/group/${ALL_USERS_GROUP}`);

      // Set impersonated access on Postgres database
      H.modifyPermission("QA Postgres12", DATA_ACCESS_PERM_IDX, "Impersonated");

      H.selectImpersonatedAttribute("role");
      H.saveImpersonationSettings();

      H.modifyPermission(
        "QA Postgres12",
        CREATE_QUERIES_PERM_IDX,
        "Query builder only",
      );

      H.savePermissions();

      cy.wait("@saveGraph").then(({ response }) => {
        expect(response.statusCode).to.equal(200);
      });

      H.assertPermissionForItem(
        "QA Postgres12",
        DATA_ACCESS_PERM_IDX,
        "Impersonated",
      );
      H.assertPermissionForItem(
        "QA Postgres12",
        CREATE_QUERIES_PERM_IDX,
        "Query builder only",
      );
    },
  );
});

describe("scenarios > admin > permissions > view data > unrestricted", () => {
  beforeEach(() => {
    H.restore();
    cy.signInAsAdmin();
    H.activateToken("pro-self-hosted");
  });

  it("should allow perms to be set to from 'can view' to 'block' and back from database view", () => {
    cy.visit(`/admin/permissions/data/database/${SAMPLE_DB_ID}`);

    H.modifyPermission("All Users", DATA_ACCESS_PERM_IDX, "Blocked");

    cy.intercept("PUT", "/api/permissions/graph").as("saveGraph");

    cy.button("Save changes").click();

    H.modal().within(() => {
      cy.findByText("Save permissions?");
      cy.button("Yes").click();
    });

    cy.wait("@saveGraph").then(({ response }) => {
      expect(response.statusCode).to.equal(200);
    });

    H.modifyPermission("All Users", DATA_ACCESS_PERM_IDX, "Can view");

    cy.button("Save changes").click();

    H.modal().within(() => {
      cy.findByText("Save permissions?");
      cy.button("Yes").click();
    });

    cy.wait("@saveGraph").then(({ response }) => {
      expect(response.statusCode).to.equal(200);
    });
  });
});

// ENFORMCENT RELATED TESTS

describe("scenarios > admin > permissions > view data > blocked (enforcement)", () => {
  beforeEach(() => {
    H.restore();
    cy.signInAsAdmin();
    H.activateToken("pro-self-hosted");
  });

  it("should deny view access to a query builder question that makes use of a blocked table", () => {
    assertCollectionGroupUserHasAccess(ORDERS_QUESTION_ID, true);
    cy.visit(
      `/admin/permissions/data/database/${SAMPLE_DB_ID}/schema/PUBLIC/table/${ORDERS_ID}`,
    );
    removeCollectionGroupPermissions();
    assertCollectionGroupHasNoAccess(ORDERS_QUESTION_ID, true);
  });

  it("should deny view access to a query builder question that makes use of a blocked database", () => {
    assertCollectionGroupUserHasAccess(ORDERS_QUESTION_ID, true);
    cy.visit(`/admin/permissions/data/database/${SAMPLE_DB_ID}`);
    removeCollectionGroupPermissions();
    assertCollectionGroupHasNoAccess(ORDERS_QUESTION_ID, true);
  });

  it("should deny view access to any native question if the user has blocked view data for any table or database", () => {
    H.createNativeQuestion({
      native: { query: "select 1" },
    }).then(({ body: { id: nativeQuestionId } }) => {
      assertCollectionGroupUserHasAccess(nativeQuestionId, false);
      cy.visit(
        `/admin/permissions/data/database/${SAMPLE_DB_ID}/schema/PUBLIC/table/${ORDERS_ID}`,
      );
      removeCollectionGroupPermissions();
      assertCollectionGroupHasNoAccess(nativeQuestionId, false);
    });
  });
});

function lackPermissionsView(isQbQuestion, shouldExist) {
  if (isQbQuestion) {
    cy.findByText("There was a problem with your question").should(
      shouldExist ? "exist" : "not.exist",
    );

    if (shouldExist) {
      cy.findByText("Show error details").click();
    }
  }

  cy.findByText(/You do not have permissions to run this query/).should(
    shouldExist ? "exist" : "not.exist",
  );
}

// NOTE: all helpers below make user of the "sandboxed" user and "collection" group to test permissions
// as this user is of only one group and has permission to view existing question

function assertCollectionGroupUserHasAccess(questionId, isQbQuestion) {
  cy.signOut();
  cy.signIn("sandboxed");

  H.visitQuestion(questionId);
  lackPermissionsView(isQbQuestion, false);

  cy.signOut();
  cy.signInAsAdmin();
}

function assertCollectionGroupHasNoAccess(questionId, isQbQuestion) {
  cy.signOut();
  cy.signIn("sandboxed");

  H.visitQuestion(questionId);

  lackPermissionsView(isQbQuestion, true);
}

function removeCollectionGroupPermissions() {
  H.assertPermissionForItem(
    "All Users",
    DATA_ACCESS_PERM_IDX,
    "Can view",
    false,
  );
  H.assertPermissionForItem(
    "collection",
    DATA_ACCESS_PERM_IDX,
    "Can view",
    false,
  );
  H.modifyPermission("All Users", DATA_ACCESS_PERM_IDX, "Blocked");
  H.modifyPermission("collection", DATA_ACCESS_PERM_IDX, "Blocked");
  H.assertSameBeforeAndAfterSave(() => {
    H.assertPermissionForItem(
      "All Users",
      DATA_ACCESS_PERM_IDX,
      "Blocked",
      false,
    );
    H.assertPermissionForItem(
      "collection",
      DATA_ACCESS_PERM_IDX,
      "Blocked",
      false,
    );
  });
}

function makeOrdersSandboxed() {
  H.modifyPermission("Orders", DATA_ACCESS_PERM_IDX, "Row and column security");

  cy.url().should(
    "include",
    `/admin/permissions/data/group/${ALL_USERS_GROUP}/database/${SAMPLE_DB_ID}/schema/PUBLIC/${ORDERS_ID}/segmented`,
  );

  cy.findByText("Configure row and column security for this table");
  cy.button("Save").should("be.disabled");

  cy.findByText("Pick a column").click();
  cy.findByText("User ID").click();

  cy.findByPlaceholderText("Pick a user attribute").click();
  cy.findByText("attr_uid").click();
  cy.button("Save").click();
}
