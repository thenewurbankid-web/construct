"use client";
/*
 * Documentation:
 * Badge — https://app.subframe.com/de62b029ca8b/library?component=Badge_97bdb082-1124-4dd7-a335-b14b822d0157
 * ReadinessRow — https://app.subframe.com/de62b029ca8b/library?component=ReadinessRow_5bc1f481-7b21-4a15-8c7e-26b72f155ce8
 */

import React from "react";
import * as SubframeUtils from "../../utils";
import { Badge } from "../Badge";

export interface ReadinessRowRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  index?: React.ReactNode;
  name?: React.ReactNode;
  level?: React.ReactNode;
  evidence?: React.ReactNode;
  status?: React.ReactNode;
  viewingLabel?: React.ReactNode;
  showViewing?: boolean;
  tone?: "ready" | "gap";
  selected?: boolean;
  className?: string;
}

const ReadinessRowRoot = React.forwardRef<
  HTMLDivElement,
  ReadinessRowRootProps
>(function ReadinessRowRoot(
  {
    index,
    name,
    level,
    evidence,
    status,
    viewingLabel,
    showViewing = false,
    tone = "ready",
    selected = false,
    className,
    ...otherProps
  }: ReadinessRowRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/5bc1f481 flex w-full cursor-pointer items-center gap-4 border-b border-solid border-neutral-200 px-4 py-4 group/readrow hover:bg-neutral-50",
        {
          "border-l-[3px] border-y-0 border-r-0 border-solid border-brand-500 bg-alpha-brand-8":
            selected,
        },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {index ? (
        <span className="w-6 flex-none text-body-2 font-body-2 text-neutral-500">
          {index}
        </span>
      ) : null}
      <div className="flex w-48 flex-none items-center gap-2">
        {name ? (
          <span className="text-subtitle-2 font-subtitle-2 text-neutral-900">
            {name}
          </span>
        ) : null}
        <Badge variant="neutral" size="xs">
          {level}
        </Badge>
      </div>
      {evidence ? (
        <span className="grow shrink-0 basis-0 text-body-2-max font-body-2-max text-neutral-600">
          {evidence}
        </span>
      ) : null}
      {status ? (
        <span
          className={SubframeUtils.twClassNames(
            "text-subtitle-2 font-subtitle-2 text-success-600 text-right",
            { "text-warning-600": tone === "gap" }
          )}
        >
          {status}
        </span>
      ) : null}
      {viewingLabel ? (
        <span
          className={SubframeUtils.twClassNames(
            "hidden w-20 flex-none text-subtitle-2 font-subtitle-2 text-accent-vivid-indigo text-right",
            { inline: showViewing }
          )}
        >
          {viewingLabel}
        </span>
      ) : null}
    </div>
  );
});

export const ReadinessRow = ReadinessRowRoot;
