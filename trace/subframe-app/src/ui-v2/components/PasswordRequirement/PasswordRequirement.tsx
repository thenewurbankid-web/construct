"use client";
/*
 * Documentation:
 * PasswordRequirement — https://app.subframe.com/de62b029ca8b/library?component=PasswordRequirement_d4c94015-2cf6-4e7f-a2a0-a209e4bf76a8
 */

import React from "react";
import { FeatherAlertCircle } from "@subframe/core";
import { FeatherCheckCircle2 } from "@subframe/core";
import { FeatherCircleDashed } from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface PasswordRequirementRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "pending" | "met" | "error";
  label?: React.ReactNode;
  className?: string;
}

const PasswordRequirementRoot = React.forwardRef<
  HTMLDivElement,
  PasswordRequirementRootProps
>(function PasswordRequirementRoot(
  {
    variant = "pending",
    label,
    className,
    ...otherProps
  }: PasswordRequirementRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/d4c94015 flex w-full items-center gap-2 py-2",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {variant === "error" ? (
        <FeatherAlertCircle
          className={SubframeUtils.twClassNames(
            "font-['Inter_Tight'] text-[20px] font-[400] leading-[30px] text-neutral-400 flex-none",
            {
              "text-error-500": variant === "error",
              "text-success-600": variant === "met",
            }
          )}
        />
      ) : variant === "met" ? (
        <FeatherCheckCircle2
          className={SubframeUtils.twClassNames(
            "font-['Inter_Tight'] text-[20px] font-[400] leading-[30px] text-neutral-400 flex-none",
            {
              "text-error-500": variant === "error",
              "text-success-600": variant === "met",
            }
          )}
        />
      ) : (
        <FeatherCircleDashed
          className={SubframeUtils.twClassNames(
            "font-['Inter_Tight'] text-[20px] font-[400] leading-[30px] text-neutral-400 flex-none",
            {
              "text-error-500": variant === "error",
              "text-success-600": variant === "met",
            }
          )}
        />
      )}
      {label ? (
        <span
          className={SubframeUtils.twClassNames(
            "text-body-1 font-body-1 text-neutral-500",
            {
              "text-error-600": variant === "error",
              "text-neutral-900": variant === "met",
            }
          )}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
});

export const PasswordRequirement = PasswordRequirementRoot;
