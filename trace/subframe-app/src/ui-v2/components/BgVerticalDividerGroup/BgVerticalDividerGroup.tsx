"use client";
/*
 * Documentation:
 * BGVerticalDividerGroup — https://app.subframe.com/de62b029ca8b/library?component=BGVerticalDividerGroup_1e59bfe9-09f4-4934-8809-c39adff6dc1d
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface BgVerticalDividerGroupRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

const BgVerticalDividerGroupRoot = React.forwardRef<
  HTMLDivElement,
  BgVerticalDividerGroupRootProps
>(function BgVerticalDividerGroupRoot(
  { className, ...otherProps }: BgVerticalDividerGroupRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "flex h-full w-full items-start justify-between px-6 max-w-[1920px]",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div className="flex grow shrink-0 basis-0 items-start justify-between self-stretch">
        <div className="flex w-px flex-none flex-col items-center gap-2 self-stretch bg-alpha-slate-4" />
        <div className="flex w-px flex-none flex-col items-center gap-2 self-stretch bg-alpha-slate-4" />
        <div className="flex w-px flex-none flex-col items-center gap-2 self-stretch bg-alpha-slate-4" />
        <div className="flex w-px flex-none flex-col items-center gap-2 self-stretch bg-alpha-slate-4" />
        <div className="flex w-px flex-none flex-col items-center gap-2 self-stretch bg-alpha-slate-4" />
      </div>
    </div>
  );
});

export const BgVerticalDividerGroup = BgVerticalDividerGroupRoot;
