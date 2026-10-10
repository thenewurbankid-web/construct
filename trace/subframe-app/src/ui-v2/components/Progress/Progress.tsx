"use client";
/*
 * Documentation:
 * Progress — https://app.subframe.com/de62b029ca8b/library?component=Progress_60964db0-a1bf-428b-b9d5-f34cdf58ea77
 */

import React from "react";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface IndicatorProps
  extends React.ComponentProps<typeof SubframeCore.Progress.Indicator> {
  size?: "base" | "sm";
  className?: string;
}

const Indicator = React.forwardRef<HTMLDivElement, IndicatorProps>(
  function Indicator(
    { size = "base", className, ...otherProps }: IndicatorProps,
    ref
  ) {
    return (
      <SubframeCore.Progress.Indicator asChild={true} {...otherProps}>
        <div
          className={SubframeUtils.twClassNames(
            "group/641ca690 flex h-2 w-full flex-col items-start gap-2 rounded-full bg-neutral-400",
            { "h-1": size === "sm" },
            className
          )}
          ref={ref}
        />
      </SubframeCore.Progress.Indicator>
    );
  }
);

export interface ProgressRootProps
  extends React.ComponentProps<typeof SubframeCore.Progress.Root> {
  value?: number;
  size?: "base" | "sm";
  type?: "default" | "error" | "brand-fancy" | "brand" | "dark" | "success";
  className?: string;
}

const ProgressRoot = React.forwardRef<HTMLDivElement, ProgressRootProps>(
  function ProgressRoot(
    {
      value = 30,
      size = "base",
      type = "default",
      className,
      ...otherProps
    }: ProgressRootProps,
    ref
  ) {
    return (
      <SubframeCore.Progress.Root asChild={true} value={value} {...otherProps}>
        <div
          className={SubframeUtils.twClassNames(
            "group/60964db0 flex h-2 w-full flex-col items-start justify-center gap-2 overflow-hidden rounded-full bg-alpha-slate-8",
            { "h-1": size === "sm" },
            className
          )}
          ref={ref}
        >
          <Indicator
            className={SubframeUtils.twClassNames({
              "bg-success-600": type === "success",
              "bg-gradient-to-r from-neutral-700 to-neutral-900":
                type === "dark",
              "bg-brand-500": type === "brand",
              "bg-gradient-to-r from-brand-400 to-brand-200":
                type === "brand-fancy",
              "bg-error-500": type === "error",
              "h-1 w-full flex-none": size === "sm",
            })}
          />
        </div>
      </SubframeCore.Progress.Root>
    );
  }
);

export const Progress = Object.assign(ProgressRoot, {
  Indicator,
});
