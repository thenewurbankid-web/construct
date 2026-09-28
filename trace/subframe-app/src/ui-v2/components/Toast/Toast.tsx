"use client";
/*
 * Documentation:
 * Toast — https://app.subframe.com/de62b029ca8b/library?component=Toast_2c7966c2-a95d-468a-83fe-bf196b95be7a
 */

import React from "react";
import { FeatherInfo } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface ToastRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  variant?: "brand" | "neutral" | "error" | "success";
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

const ToastRoot = React.forwardRef<HTMLDivElement, ToastRootProps>(
  function ToastRoot(
    {
      variant = "neutral",
      icon = <FeatherInfo />,
      title,
      description,
      actions,
      className,
      ...otherProps
    }: ToastRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/2c7966c2 flex w-80 items-center gap-4 rounded-rounded-md bg-default-background px-4 py-3 shadow-[0px_12px_32px_-4px_#11162a14,0px_4px_8px_-2px_#11162a14]",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {icon ? (
          <SubframeCore.IconWrapper
            className={SubframeUtils.twClassNames(
              "font-['Inter_Tight'] text-[16px] font-[500] leading-[24px] text-neutral-700",
              {
                "text-success-700": variant === "success",
                "text-error-700": variant === "error",
                "text-brand-500": variant === "brand",
              }
            )}
          >
            {icon}
          </SubframeCore.IconWrapper>
        ) : null}
        <div className="flex grow shrink-0 basis-0 flex-col items-start">
          {title ? (
            <span
              className={SubframeUtils.twClassNames(
                "w-full text-body-2-bold font-body-2-bold text-default-font",
                {
                  "text-success-700": variant === "success",
                  "text-error-700": variant === "error",
                  "text-brand-700": variant === "brand",
                }
              )}
            >
              {title}
            </span>
          ) : null}
          {description ? (
            <span className="w-full text-caption font-caption text-subtext-color">
              {description}
            </span>
          ) : null}
        </div>
        {actions ? (
          <div className="flex items-center justify-end gap-1">{actions}</div>
        ) : null}
      </div>
    );
  }
);

export const Toast = ToastRoot;
