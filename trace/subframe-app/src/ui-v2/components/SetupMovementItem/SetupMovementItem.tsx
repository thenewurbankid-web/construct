"use client";
/*
 * Documentation:
 * Setup Movement Item — https://app.subframe.com/de62b029ca8b/library?component=Setup+Movement+Item_3cdaa8e9-3832-4946-9c4c-3ba5efd32c19
 */

import React from "react";
import { FeatherArrowUpRight } from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface SetupMovementItemRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  state?: "current" | "next" | "later" | "done";
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actionText?: React.ReactNode;
  stepNumber?: React.ReactNode;
  className?: string;
}

const SetupMovementItemRoot = React.forwardRef<
  HTMLDivElement,
  SetupMovementItemRootProps
>(function SetupMovementItemRoot(
  {
    state = "current",
    eyebrow,
    title,
    description,
    actionText,
    stepNumber,
    className,
    ...otherProps
  }: SetupMovementItemRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/3cdaa8e9 flex w-full items-start gap-6",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div
        className={SubframeUtils.twClassNames("flex items-start gap-2 pt-7", {
          "pt-4": state === "done" || state === "later" || state === "next",
        })}
      >
        {stepNumber ? (
          <span
            className={SubframeUtils.twClassNames(
              "w-12 flex-none text-h3-max font-h3-max text-alpha-slate-24 text-right",
              {
                "text-h4-max font-h4-max":
                  state === "done" || state === "later" || state === "next",
              }
            )}
          >
            {stepNumber}
          </span>
        ) : null}
      </div>
      <div
        className={SubframeUtils.twClassNames(
          "flex grow shrink-0 basis-0 flex-col items-start",
          {
            "opacity-55 transition-[opacity,transform] duration-300 group-hover/3cdaa8e9:opacity-100 group-hover/3cdaa8e9:translate-x-[3px]":
              state === "done",
            "opacity-40 cursor-default": state === "later",
            "opacity-60 cursor-default": state === "next",
          }
        )}
      >
        <div
          className={SubframeUtils.twClassNames(
            "hidden w-full items-start border-t border-solid border-alpha-slate-12",
            { flex: state === "done" || state === "later" || state === "next" }
          )}
        />
        {eyebrow ? (
          <span
            className={SubframeUtils.twClassNames(
              "w-full text-overline-xs-mono font-overline-xs-mono text-accent-vivid-indigo uppercase",
              {
                "text-neutral-600 pt-5":
                  state === "done" || state === "later" || state === "next",
              }
            )}
          >
            {eyebrow}
          </span>
        ) : null}
        <div className="flex w-full flex-col items-start gap-2">
          {title ? (
            <span
              className={SubframeUtils.twClassNames(
                "w-full text-h3 font-h3 text-default-font max-w-[21ch] pt-3.5",
                {
                  "text-h6 font-h6 max-w-[24ch] pt-2.5":
                    state === "done" || state === "later" || state === "next",
                }
              )}
            >
              {title}
            </span>
          ) : null}
          {description ? (
            <span
              className={SubframeUtils.twClassNames(
                "w-full text-body-1 font-body-1 text-neutral-600 max-w-[46ch]",
                {
                  hidden:
                    state === "done" || state === "later" || state === "next",
                }
              )}
            >
              {description}
            </span>
          ) : null}
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "hidden items-center gap-1.5 pt-3",
            { flex: state === "done" }
          )}
        >
          {actionText ? (
            <span className="text-overline-xs-mono font-overline-xs-mono text-accent-vivid-indigo uppercase">
              {actionText}
            </span>
          ) : null}
          <FeatherArrowUpRight className="text-caption-xs font-caption-xs text-accent-vivid-indigo" />
        </div>
      </div>
    </div>
  );
});

export const SetupMovementItem = SetupMovementItemRoot;
