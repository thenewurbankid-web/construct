"use client";
/*
 * Documentation:
 * SetupStatPile — https://app.subframe.com/de62b029ca8b/library?component=SetupStatPile_2f42bbc5-8761-4f57-ba0e-1a4b543af3ca
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface SetupStatPileRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  value?: React.ReactNode;
  label?: React.ReactNode;
  tone?: "brand" | "neutral";
  size?: "default" | "large";
  centered?: boolean;
  className?: string;
}

const SetupStatPileRoot = React.forwardRef<
  HTMLDivElement,
  SetupStatPileRootProps
>(function SetupStatPileRoot(
  {
    value,
    label,
    tone = "brand",
    size = "default",
    centered = false,
    className,
    ...otherProps
  }: SetupStatPileRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/2f42bbc5 flex flex-col items-start gap-1 px-3 py-3",
        { "items-center": centered, "gap-0.5": size === "large" },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {value ? (
        <span
          className={SubframeUtils.twClassNames(
            "text-h4-max font-h4-max text-brand-500",
            {
              "text-h2-max font-h2-max": size === "large",
              "text-neutral-900": tone === "neutral",
            }
          )}
        >
          {value}
        </span>
      ) : null}
      {label ? (
        <span
          className={SubframeUtils.twClassNames(
            "text-body-2 font-body-2 text-neutral-600",
            { "text-center": centered }
          )}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
});

export const SetupStatPile = SetupStatPileRoot;
