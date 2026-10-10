"use client";
/*
 * Documentation:
 * Badge — https://app.subframe.com/de62b029ca8b/library?component=Badge_97bdb082-1124-4dd7-a335-b14b822d0157
 * Checkbox — https://app.subframe.com/de62b029ca8b/library?component=Checkbox_3816e3b5-c48c-499b-b45e-0777c6972523
 * ScopeCategoryRow — https://app.subframe.com/de62b029ca8b/library?component=ScopeCategoryRow_67594cf5-9e62-4414-883a-59530c38ceb1
 */

import React from "react";
import * as SubframeUtils from "../../utils";
import { Badge } from "../Badge";
import { Checkbox } from "../Checkbox";

export interface ScopeCategoryRowRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  name?: React.ReactNode;
  level?: React.ReactNode;
  parentPath?: React.ReactNode;
  showParentPath?: boolean;
  evidence?: React.ReactNode;
  actionLabel?: React.ReactNode;
  state?: "default" | "selected";
  className?: string;
}

const ScopeCategoryRowRoot = React.forwardRef<
  HTMLDivElement,
  ScopeCategoryRowRootProps
>(function ScopeCategoryRowRoot(
  {
    name,
    level,
    parentPath,
    showParentPath = false,
    evidence,
    actionLabel,
    state = "default",
    className,
    ...otherProps
  }: ScopeCategoryRowRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/67594cf5 flex w-full cursor-pointer items-center gap-4 border-b border-solid border-neutral-200 px-4 py-4 hover:bg-neutral-50",
        {
          "rounded-rounded-xs border-l-[3px] border-y-0 border-r-0 border-solid border-brand-500 bg-alpha-brand-8 hover:bg-alpha-brand-12":
            state === "selected",
        },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <Checkbox label="" checked={true} />
      <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start gap-0.5">
        <div className="flex items-center gap-2">
          {name ? (
            <span className="text-subtitle-2 font-subtitle-2 text-neutral-900">
              {name}
            </span>
          ) : null}
          <Badge variant="neutral" size="xs">
            {level}
          </Badge>
        </div>
        {parentPath ? (
          <span
            className={SubframeUtils.twClassNames(
              "hidden text-body-2 font-body-2 text-neutral-600",
              { inline: showParentPath }
            )}
          >
            {parentPath}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-8">
        {evidence ? (
          <span className="whitespace-nowrap text-body-2 font-body-2 text-neutral-600 text-right">
            {evidence}
          </span>
        ) : null}
        {actionLabel ? (
          <span className="whitespace-nowrap text-subtitle-2 font-subtitle-2 text-accent-vivid-indigo cursor-pointer">
            {actionLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
});

export const ScopeCategoryRow = ScopeCategoryRowRoot;
