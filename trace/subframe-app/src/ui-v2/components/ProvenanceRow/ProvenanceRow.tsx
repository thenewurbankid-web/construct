"use client";
/*
 * Documentation:
 * Provenance Row — https://app.subframe.com/de62b029ca8b/library?component=Provenance+Row_820f98b5-9353-4ba9-b20e-28e5182a1749
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface ProvenanceRowRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  mark?: React.ReactNode;
  claim?: React.ReactNode;
  method?: React.ReactNode;
  sourcesSlot?: React.ReactNode;
  trailingSlot?: React.ReactNode;
  tone?: "default" | "held" | "absent";
  emphasis?: "default" | "pending";
  className?: string;
}

const ProvenanceRowRoot = React.forwardRef<
  HTMLDivElement,
  ProvenanceRowRootProps
>(function ProvenanceRowRoot(
  {
    mark,
    claim,
    method,
    sourcesSlot,
    trailingSlot,
    tone = "default",
    emphasis = "default",
    className,
    ...otherProps
  }: ProvenanceRowRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/820f98b5 flex w-full cursor-pointer items-start gap-4 rounded-rounded-sm border-b border-solid border-alpha-slate-12 px-3 py-4 transition-[background-color,box-shadow] hover:bg-default-background hover:shadow-soft",
        { "opacity-60": emphasis === "pending" },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {mark ? (
        <span
          className={SubframeUtils.twClassNames(
            "h-7 text-overline-xs-mono font-overline-xs-mono text-neutral-700 text-center flex w-[74px] items-center justify-center rounded-rounded-xs bg-alpha-slate-8 px-1.5 uppercase",
            {
              "text-neutral-400 bg-alpha-slate-4": tone === "absent",
              "text-success-800 bg-success-100": tone === "held",
            }
          )}
        >
          {mark}
        </span>
      ) : null}
      <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start gap-1.5">
        {claim ? (
          <span
            className={SubframeUtils.twClassNames(
              "w-full text-subtitle-2 font-subtitle-2 text-default-font",
              { "text-neutral-400": tone === "absent" }
            )}
          >
            {claim}
          </span>
        ) : null}
        {method ? (
          <span
            className={SubframeUtils.twClassNames(
              "w-full text-caption font-caption text-neutral-600",
              { "text-orange-700": tone === "absent" }
            )}
          >
            {method}
          </span>
        ) : null}
        {sourcesSlot ? (
          <div className="flex w-full flex-wrap items-center gap-1.5 pt-1">
            {sourcesSlot}
          </div>
        ) : null}
      </div>
      {trailingSlot ? (
        <div className="flex items-center gap-2 pt-0.5">{trailingSlot}</div>
      ) : null}
    </div>
  );
});

export const ProvenanceRow = ProvenanceRowRoot;
