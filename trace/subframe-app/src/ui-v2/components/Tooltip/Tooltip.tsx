"use client";
/*
 * Documentation:
 * Tooltip — https://app.subframe.com/de62b029ca8b/library?component=Tooltip_ccebd1e9-f6ac-4737-8376-0dfacd90c9f3
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface TooltipRootProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
}

const TooltipRoot = React.forwardRef<HTMLDivElement, TooltipRootProps>(
  function TooltipRoot(
    { children, className, ...otherProps }: TooltipRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "flex flex-col items-start gap-2 rounded-[10px] bg-neutral-700 px-3 py-1.5 shadow-[0px_12px_32px_-4px_#11162a14,0px_4px_8px_-2px_#11162a14]",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {children ? (
          <span className="text-caption font-caption text-white">
            {children}
          </span>
        ) : null}
      </div>
    );
  }
);

export const Tooltip = TooltipRoot;
