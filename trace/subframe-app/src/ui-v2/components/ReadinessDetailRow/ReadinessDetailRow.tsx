"use client";
/*
 * Documentation:
 * ReadinessDetailRow — https://app.subframe.com/de62b029ca8b/library?component=ReadinessDetailRow_6db3b7e5-c625-4457-b887-ca921b42b939
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface ReadinessDetailRowRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  sub?: React.ReactNode;
  status?: React.ReactNode;
  tone?: "ready" | "unavailable";
  className?: string;
}

const ReadinessDetailRowRoot = React.forwardRef<
  HTMLDivElement,
  ReadinessDetailRowRootProps
>(function ReadinessDetailRowRoot(
  {
    label,
    sub,
    status,
    tone = "ready",
    className,
    ...otherProps
  }: ReadinessDetailRowRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/6db3b7e5 flex w-full items-start justify-between border-b border-solid border-neutral-200 py-3 gap-4",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div className="flex grow shrink-0 basis-0 flex-col items-start gap-0.5">
        {label ? (
          <span className="text-subtitle-2 font-subtitle-2 text-neutral-900">
            {label}
          </span>
        ) : null}
        {sub ? (
          <span className="text-caption font-caption text-neutral-500">
            {sub}
          </span>
        ) : null}
      </div>
      {status ? (
        <span
          className={SubframeUtils.twClassNames(
            "text-subtitle-2 font-subtitle-2 text-success-600",
            { "text-warning-600": tone === "unavailable" }
          )}
        >
          {status}
        </span>
      ) : null}
    </div>
  );
});

export const ReadinessDetailRow = ReadinessDetailRowRoot;
