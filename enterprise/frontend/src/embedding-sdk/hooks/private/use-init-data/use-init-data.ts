import { useEffect, useRef } from "react";
import { useMount } from "react-use";
import _ from "underscore";

import { getEmbeddingSdkVersion } from "embedding-sdk/config";
import { useSdkDispatch, useSdkSelector } from "embedding-sdk/store";
import { initAuth } from "embedding-sdk/store/auth";
import { setFetchRefreshTokenFn } from "embedding-sdk/store/reducer";
import {
  getFetchRefreshTokenFn,
  getLoginStatus,
} from "embedding-sdk/store/selectors";
import type { MetabaseAuthConfig } from "embedding-sdk/types";
import { EMBEDDING_SDK_CONFIG } from "metabase/embedding-sdk/config";
import api from "metabase/lib/api";
import registerVisualizations from "metabase/visualizations/register";

const registerVisualizationsOnce = _.once(registerVisualizations);

interface InitDataLoaderParameters {
  authConfig: MetabaseAuthConfig;
  allowConsoleLog?: boolean;
}

export const useInitData = ({
  authConfig,
  allowConsoleLog = true,
}: InitDataLoaderParameters) => {
  // react calls some lifecycle hooks twice in dev mode, the auth init fires some http requests and when it's called twice,
  // it fires them twice as well, making debugging harder as they show up twice in the network tab and in the logs
  const hasBeenInitialized = useRef(false);

  const dispatch = useSdkDispatch();

  const loginStatus = useSdkSelector(getLoginStatus);
  const fetchRefreshTokenFnFromStore = useSdkSelector(getFetchRefreshTokenFn);

  // This is outside of a useEffect otherwise calls done on the first render could use the wrong value
  // This is the case for example for the locale json files
  if (api.basename !== authConfig.metabaseInstanceUrl) {
    api.basename = authConfig.metabaseInstanceUrl;
  }

  useEffect(() => {
    if (authConfig.fetchRequestToken !== fetchRefreshTokenFnFromStore) {
      // This needs to be a useEffect to avoid the `Cannot update a component XX while rendering a different component` error
      dispatch(setFetchRefreshTokenFn(authConfig.fetchRequestToken ?? null));
    }
  }, [authConfig.fetchRequestToken, fetchRefreshTokenFnFromStore, dispatch]);

  useMount(() => {
    if (hasBeenInitialized.current) {
      return;
    }
    hasBeenInitialized.current = true;

    registerVisualizationsOnce();

    // Note: this check is not actually needed in prod, but some of our tests start with a loginStatus already initialized
    // and they don't mock the network requests so the tests fail
    if (loginStatus.status === "uninitialized") {
      dispatch(initAuth(authConfig));
    }

    const EMBEDDING_SDK_VERSION = getEmbeddingSdkVersion();
    api.requestClient = {
      name: EMBEDDING_SDK_CONFIG.metabaseClientRequestHeader,
      version: EMBEDDING_SDK_VERSION,
    };

    if (allowConsoleLog) {
      // eslint-disable-next-line no-console
      console.log(
        // eslint-disable-next-line no-literal-metabase-strings -- Not a user facing string
        `Using Metabase Embedding SDK, version ${EMBEDDING_SDK_VERSION}`,
      );
    }
  });
};
