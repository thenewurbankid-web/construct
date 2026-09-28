"use client";
/*
 * Documentation:
 * Feature Icon — https://app.subframe.com/de62b029ca8b/library?component=Feature+Icon_4e1f81be-2060-425c-af29-81c1876c6e72
 */

import React from "react";
import { FeatherFileText } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface FeatureIconRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xs";
  tone?: "brand" | "neutral" | "error" | "success";
  className?: string;
}

const FeatureIconRoot = React.forwardRef<HTMLDivElement, FeatureIconRootProps>(
  function FeatureIconRoot(
    {
      icon = <FeatherFileText />,
      size = "sm",
      tone = "brand",
      className,
      ...otherProps
    }: FeatureIconRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/4e1f81be flex h-10 w-10 items-center justify-center group/featureicon",
          {
            "h-6 w-6": size === "xs",
            "h-[72px] w-[72px]": size === "lg",
            "h-14 w-14": size === "md",
          },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "flex items-center justify-center rounded-t-rounded-xs px-px py-px -rotate-12 bg-gradient-to-b from-alpha-brand-16 to-alpha-brand-0",
            {
              "-rotate-12 bg-gradient-to-b from-alpha-success-16 to-alpha-success-0":
                tone === "success",
              "-rotate-12 bg-gradient-to-b from-alpha-error-16 to-alpha-error-0":
                tone === "error",
              "-rotate-12 bg-gradient-to-b from-alpha-slate-12 to-alpha-slate-0":
                tone === "neutral",
              "rounded-t-[4px] rounded-b-none": size === "xs",
              "rounded-t-rounded-md rounded-b-none": size === "lg",
              "rounded-t-rounded-sm rounded-b-none": size === "md",
            }
          )}
        >
          <div
            className={SubframeUtils.twClassNames(
              "flex h-8 w-8 flex-none items-center justify-center rounded-t-[7px] bg-gradient-to-b from-alpha-brand-12 to-alpha-brand-0",
              {
                "bg-gradient-to-b from-alpha-success-16 to-alpha-success-0":
                  tone === "success",
                "bg-gradient-to-b from-alpha-error-16 to-alpha-error-0":
                  tone === "error",
                "bg-gradient-to-b from-alpha-slate-8 to-alpha-slate-0":
                  tone === "neutral",
                "h-5 w-5 rounded-t-[3px] rounded-b-none": size === "xs",
                "h-14 w-14 rounded-t-[15px] rounded-b-none": size === "lg",
                "h-11 w-11 rounded-[11px]": size === "md",
              }
            )}
          >
            {icon ? (
              <SubframeCore.IconWrapper
                className={SubframeUtils.twClassNames(
                  "font-['Inter_Tight'] text-[16px] font-[400] leading-[16px] text-accent-vivid-indigo flex-none rotate-12",
                  {
                    "text-success-600": tone === "success",
                    "text-error-600": tone === "error",
                    "text-neutral-600": tone === "neutral",
                    "text-[12px] leading-[12px] tracking-normal": size === "xs",
                    "text-[24px] leading-[24px] tracking-normal": size === "lg",
                    "text-[20px] leading-[20px] tracking-normal": size === "md",
                  }
                )}
              >
                {icon}
              </SubframeCore.IconWrapper>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
);

export const FeatureIcon = FeatureIconRoot;
