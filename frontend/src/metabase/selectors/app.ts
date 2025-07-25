import type { Selector } from "@reduxjs/toolkit";
import { createSelector } from "@reduxjs/toolkit";
import type { Location } from "history";

import {
  getDashboard,
  getDashboardId,
  getIsEditing as getIsEditingDashboard,
} from "metabase/dashboard/selectors";
import {
  getIsSavedQuestionChanged,
  getQuestion,
} from "metabase/query_builder/selectors";
import {
  getEmbedOptions,
  getIsEmbeddingIframe,
} from "metabase/selectors/embed";
import { getUser } from "metabase/selectors/user";
import type { State } from "metabase-types/store";

import { getSetting } from "./settings";

export interface RouterProps {
  location: Location;
}

const PATHS_WITHOUT_NAVBAR = [
  /^\/setup/,
  /^\/auth/,
  /\/model\/.*\/query/,
  /\/model\/.*\/metadata/,
  /\/model\/query/,
  /\/model\/metadata/,
  /\/metric\/.*\/query/,
  /\/metric\/.*\/metadata/,
  /\/metric\/query/,
  /\/metric\/metadata/,
];

const PATHS_WITH_COLLECTION_BREADCRUMBS = [
  /\/question\//,
  /\/model\//,
  /\/metric\//,
  /\/dashboard\//,
];
const PATHS_WITH_QUESTION_LINEAGE = [/\/question/, /\/model/];

export const getRouterPath = (state: State, props: RouterProps) => {
  return props?.location?.pathname ?? window.location.pathname;
};

export const getRouterHash = (state: State, props: RouterProps) => {
  return props?.location?.hash ?? window.location.hash;
};

export const getIsAdminApp = createSelector([getRouterPath], (path) => {
  return path.startsWith("/admin/");
});

export const getIsEmbeddingSetup = createSelector([getRouterPath], (path) => {
  return path.startsWith("/setup/embedding");
});

export const getIsCollectionPathVisible = createSelector(
  [
    getQuestion,
    getDashboard,
    getRouterPath,
    getIsEmbeddingIframe,
    getEmbedOptions,
  ],
  (question, dashboard, path, isEmbedded, embedOptions) => {
    if (isEmbedded && !embedOptions.breadcrumbs) {
      return false;
    }

    return (
      ((question != null && question.isSaved()) || dashboard != null) &&
      PATHS_WITH_COLLECTION_BREADCRUMBS.some((pattern) => pattern.test(path))
    );
  },
);

export const getIsQuestionLineageVisible = createSelector(
  [getIsSavedQuestionChanged, getRouterPath],
  (isSavedQuestionChanged, path) =>
    isSavedQuestionChanged &&
    PATHS_WITH_QUESTION_LINEAGE.some((pattern) => pattern.test(path)),
);

export const getIsNavBarEnabled = createSelector(
  [
    getUser,
    getRouterPath,
    getIsEditingDashboard,
    getIsEmbeddingIframe,
    getEmbedOptions,
  ],
  (currentUser, path, isEditingDashboard, isEmbedded, embedOptions) => {
    if (!currentUser || isEditingDashboard) {
      return false;
    }
    if (isEmbedded && !embedOptions.side_nav) {
      return false;
    }

    return !PATHS_WITHOUT_NAVBAR.some((pattern) => pattern.test(path));
  },
);

const getIsEmbeddedAppBarVisible = createSelector(
  [
    getEmbedOptions,
    getIsQuestionLineageVisible,
    getIsCollectionPathVisible,
    getIsNavBarEnabled,
  ],
  (
    embedOptions,
    isQuestionLineageVisible,
    isCollectionPathVisible,
    isNavBarEnabled,
  ) => {
    const anyEmbeddedAppBarElementVisible =
      isNavBarEnabled ||
      embedOptions.search ||
      embedOptions.new_button ||
      embedOptions.logo ||
      isQuestionLineageVisible ||
      isCollectionPathVisible;
    return embedOptions.top_nav && anyEmbeddedAppBarElementVisible;
  },
);

export const getIsAppBarVisible = createSelector(
  [
    getUser,
    getRouterPath,
    getRouterHash,
    getIsAdminApp,
    getIsEditingDashboard,
    getIsEmbeddingIframe,
    getIsEmbeddedAppBarVisible,
  ],
  (
    currentUser,
    path,
    hash,
    isAdminApp,
    isEditingDashboard,
    isEmbedded,
    isEmbeddedAppBarVisible,
  ) => {
    const isFullscreen = hash.includes("fullscreen");

    if (
      !currentUser ||
      (isEmbedded && !isEmbeddedAppBarVisible) ||
      isAdminApp ||
      isEditingDashboard ||
      isFullscreen
    ) {
      return false;
    }
    return !PATHS_WITHOUT_NAVBAR.some((pattern) => pattern.test(path));
  },
);

export const getIsLogoVisible = createSelector(
  [getIsEmbeddingIframe, getEmbedOptions],
  (isEmbeddingIframe, embedOptions) => {
    return !isEmbeddingIframe || embedOptions.logo;
  },
);

export const getIsSearchVisible = createSelector(
  [getIsEmbeddingIframe, getEmbedOptions],
  (isEmbeddingIframe, embedOptions) => {
    return !isEmbeddingIframe || embedOptions.search;
  },
);

export const getIsNewButtonVisible = createSelector(
  [getIsEmbeddingIframe, getEmbedOptions],
  (isEmbeddingIframe, embedOptions) => {
    return !isEmbeddingIframe || embedOptions.new_button;
  },
);

export const getIsProfileLinkVisible = createSelector(
  [getIsEmbeddingIframe],
  (isEmbeddingIframe) => !isEmbeddingIframe,
);

export const getErrorPage = (state: State) => {
  return state.app.errorPage;
};

export const getErrorMessage = (state: State) => {
  const errorPage = getErrorPage(state);
  return errorPage?.data?.message || errorPage?.data;
};

export const getCollectionId = createSelector(
  [getQuestion, getDashboard, getDashboardId],
  (question, dashboard, dashboardId) =>
    dashboardId ? dashboard?.collection_id : question?.collectionId(),
);

export const getIsNavbarOpen: Selector<State, boolean> = createSelector(
  [
    getIsEmbeddingIframe,
    getEmbedOptions,
    getIsAppBarVisible,
    (state: State) => state.app.isNavbarOpen,
  ],
  (isEmbeddingIframe, embedOptions, isAppBarVisible, isNavbarOpen) => {
    // in an embedded instance, when the app bar is hidden, but the nav bar is not
    // we need to force the sidebar to be open or else it will be totally inaccessible
    if (
      isEmbeddingIframe &&
      embedOptions.side_nav === true &&
      !isAppBarVisible
    ) {
      return true;
    }

    return isNavbarOpen;
  },
);

export const getIsDndAvailable = (state: State) => {
  return state.app.isDndAvailable;
};

export const getCustomHomePageDashboardId = createSelector(
  [getUser],
  (user) => user?.custom_homepage?.dashboard_id || null,
);

export const getHasDismissedCustomHomePageToast = (state: State) => {
  return getSetting(state, "dismissed-custom-dashboard-toast");
};

export const getIsErrorDiagnosticModalOpen = (state: State) =>
  state.app.isErrorDiagnosticsOpen;
