"use client";
/*
 * Documentation:
 * PriorityCard — https://app.subframe.com/de62b029ca8b/library?component=PriorityCard_22ec28bf-f218-4214-b0c6-33d0d7a8cfe8
 */

import React from "react";
import { FeatherBadgeDollarSign } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface PriorityCardRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  levelLabel?: React.ReactNode;
  level?: "low" | "medium" | "high";
  className?: string;
}

const PriorityCardRoot = React.forwardRef<
  HTMLDivElement,
  PriorityCardRootProps
>(function PriorityCardRoot(
  {
    icon = <FeatherBadgeDollarSign />,
    title,
    subtitle,
    levelLabel,
    level = "medium",
    className,
    ...otherProps
  }: PriorityCardRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/22ec28bf flex w-full flex-col items-start gap-3 rounded-rounded-md border border-solid border-neutral-200 bg-default-background px-5 py-4 shadow-sm",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div className="flex w-full items-start gap-3">
        {icon ? (
          <SubframeCore.IconWrapper className="font-['Inter_Tight'] text-[20px] font-[400] leading-[30px] text-neutral-600 flex-none">
            {icon}
          </SubframeCore.IconWrapper>
        ) : null}
        <div className="flex grow shrink-0 basis-0 flex-col items-start gap-0.5">
          {title ? (
            <span className="text-subtitle-1 font-subtitle-1 text-neutral-900">
              {title}
            </span>
          ) : null}
          {subtitle ? (
            <span className="text-body-2 font-body-2 text-neutral-600">
              {subtitle}
            </span>
          ) : null}
        </div>
        {levelLabel ? (
          <span
            className={SubframeUtils.twClassNames(
              "text-subtitle-1 font-subtitle-1 text-warning-600 text-right",
              {
                "text-success-600": level === "high",
                "text-pink-600": level === "low",
              }
            )}
          >
            {levelLabel}
          </span>
        ) : null}
      </div>
      <div className="flex w-full flex-col items-start gap-1.5">
        <div className="flex w-full items-center justify-between">
          <span className="text-caption font-caption text-neutral-500">
            Low
          </span>
          <span className="text-caption font-caption text-neutral-500">
            Medium
          </span>
          <span className="text-caption font-caption text-neutral-500">
            High
          </span>
        </div>
        <div className="flex h-1 w-full flex-none items-start rounded-full bg-neutral-200 relative">
          <div
            className={SubframeUtils.twClassNames(
              "flex h-1 items-start rounded-full bg-brand-500 absolute left-0 w-1/2",
              { "w-[96%]": level === "high", "w-[4%]": level === "low" }
            )}
          />
          <div
            className={SubframeUtils.twClassNames(
              "flex h-5 w-5 flex-none items-start rounded-full border-2 border-solid border-brand-500 bg-default-background absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2",
              { "left-[96%]": level === "high", "left-[4%]": level === "low" }
            )}
          />
        </div>
      </div>
    </div>
  );
});

export const PriorityCard = PriorityCardRoot;
