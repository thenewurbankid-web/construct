"use client";
/*
 * Documentation:
 * Suggestion — https://app.subframe.com/de62b029ca8b/library?component=Suggestion_c5e538eb-4e81-44b6-a6a7-5ae7c8720f3b
 */

import React from "react";
import { FeatherChevronDown } from "@subframe/core";
import { FeatherCornerDownRight } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface SuggestionRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  tone?: "brand" | "neutral";
  type?: "default" | "custom-prompt";
  state?: "default" | "hover";
  label?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

const SuggestionRoot = React.forwardRef<HTMLDivElement, SuggestionRootProps>(
  function SuggestionRoot(
    {
      tone = "brand",
      type = "default",
      state = "default",
      label,
      icon = <FeatherCornerDownRight />,
      className,
      ...otherProps
    }: SuggestionRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/c5e538eb flex h-8 max-w-[320px] cursor-pointer items-center gap-2 overflow-hidden rounded-[8px] border border-solid border-alpha-brand-16 bg-alpha-brand-4 px-3 py-1.5 group/suggestion hover:bg-alpha-brand-8 hover:border-alpha-brand-24",
          {
            "border border-solid border-alpha-brand-24 bg-alpha-brand-8":
              state === "hover",
            "border border-dashed border-alpha-brand-96 bg-transparent hover:border-alpha-brand-96":
              type === "custom-prompt",
            "border border-dashed border-neutral-200 hover:border-neutral-200":
              tone === "neutral",
          },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex h-5 w-5 flex-none items-center justify-center">
          {icon ? (
            <SubframeCore.IconWrapper
              className={SubframeUtils.twClassNames(
                "text-body-1 font-body-1 text-accent-vivid-indigo",
                { "text-neutral-600": tone === "neutral" }
              )}
            >
              {icon}
            </SubframeCore.IconWrapper>
          ) : null}
        </div>
        {label ? (
          <div
            className={SubframeUtils.twClassNames(
              "flex min-w-[0px] grow shrink-0 basis-0 items-start overflow-hidden text-body-2-max font-body-2-max text-accent-vivid-indigo",
              { "text-neutral-600": tone === "neutral" }
            )}
          >
            {label}
          </div>
        ) : null}
        <div
          className={SubframeUtils.twClassNames(
            "hidden h-5 w-5 flex-none items-center justify-center",
            { flex: type === "custom-prompt" }
          )}
        >
          <FeatherChevronDown
            className={SubframeUtils.twClassNames(
              "text-body-1 font-body-1 text-accent-vivid-indigo",
              { "text-neutral-600": tone === "neutral" }
            )}
          />
        </div>
      </div>
    );
  }
);

export const Suggestion = SuggestionRoot;
