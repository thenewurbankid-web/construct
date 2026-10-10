"use client";
/*
 * Documentation:
 * Alert — https://app.subframe.com/de62b029ca8b/library?component=Alert_3a65613d-d546-467c-80f4-aaba6a7edcd5
 */

import React from "react";
import { FeatherAlertCircle } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface AlertRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  variant?: "neutral" | "error" | "success" | "warning" | "info";
  icon?: React.ReactNode;
  className?: string;
}

const AlertRoot = React.forwardRef<HTMLDivElement, AlertRootProps>(
  function AlertRoot(
    {
      title,
      description,
      actions,
      variant = "neutral",
      icon = <FeatherAlertCircle />,
      className,
      ...otherProps
    }: AlertRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/3a65613d flex w-full max-w-[768px] flex-col items-start justify-center rounded-rounded-sm border border-solid border-alpha-slate-8 bg-alpha-slate-8 pl-3 pr-4",
          {
            "border border-solid border-alpha-brand-32 bg-alpha-brand-8":
              variant === "info",
            "border border-solid border-alpha-warning-12 bg-alpha-warning-24":
              variant === "warning",
            "border border-solid border-alpha-success-32 bg-alpha-success-8":
              variant === "success",
            "border border-solid border-alpha-error-16 bg-alpha-error-16":
              variant === "error",
          },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex w-full items-start gap-3 py-3">
          <div className="flex h-8 w-8 flex-none items-center justify-center">
            {icon ? (
              <SubframeCore.IconWrapper
                className={SubframeUtils.twClassNames(
                  "font-['Inter_Tight'] text-[20px] font-[400] leading-[30px] text-neutral-600",
                  {
                    "text-brand-600": variant === "info",
                    "text-warning-700": variant === "warning",
                    "text-success-700": variant === "success",
                    "text-error-700": variant === "error",
                  }
                )}
              >
                {icon}
              </SubframeCore.IconWrapper>
            ) : null}
          </div>
          <div className="flex min-h-[32px] grow shrink-0 basis-0 flex-col items-start justify-center gap-1">
            {title ? (
              <span
                className={SubframeUtils.twClassNames(
                  "line-clamp-1 w-full text-subtitle-2 font-subtitle-2 text-neutral-900",
                  {
                    "text-brand-700": variant === "info",
                    "text-warning-800": variant === "warning",
                    "text-success-800": variant === "success",
                    "text-error-800": variant === "error",
                  }
                )}
              >
                {title}
              </span>
            ) : null}
            {description ? (
              <span
                className={SubframeUtils.twClassNames(
                  "w-full text-caption font-caption text-neutral-600",
                  {
                    "text-brand-600": variant === "info",
                    "text-warning-700": variant === "warning",
                    "text-success-700": variant === "success",
                    "text-error-700": variant === "error",
                  }
                )}
              >
                {description}
              </span>
            ) : null}
          </div>
          {actions ? (
            <div className="flex h-8 items-center gap-3">{actions}</div>
          ) : null}
        </div>
      </div>
    );
  }
);

export const Alert = AlertRoot;
