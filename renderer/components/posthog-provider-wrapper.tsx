import { enableContributionAtom } from "@/atoms/user-settings-atom";
import { useAtomValue } from "jotai";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect } from "react";
import { useRuntime } from "@/runtime/runtime-context";

const PostHogProviderWrapper = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const enableContribution = useAtomValue(enableContributionAtom);
  const runtime = useRuntime();

  useEffect(() => {
    posthog.init("phc_QMcmlmComdofjfaRPzoN4KV9ziV2KgOwAOVyu4J3dIc", {
      api_host: "https://us.i.posthog.com",
      person_profiles: "always",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      loaded: async (posthog) => {
        if (process.env.NODE_ENV === "development") posthog.debug();
        try {
          const systemInfo = await runtime.getSystemInfo();
          const appVersion = await runtime.getVersion();
          // Set super properties that will be included with all events
          posthog.register({
            ...systemInfo,
            appVersion,
          });
          // Capture initial session start
          posthog.capture("app_launched", {
            ...systemInfo,
            appVersion,
          });
        } catch (error) {
          console.warn("Runtime system information is unavailable", error);
        }
      },
    });
  }, [runtime]);

  if (enableContribution === false) return <>{children}</>;

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
};

export default PostHogProviderWrapper;
