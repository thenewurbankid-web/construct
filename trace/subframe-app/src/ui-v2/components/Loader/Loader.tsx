"use client";
/*
 * Documentation:
 * Loader — https://app.subframe.com/de62b029ca8b/library?component=Loader_f2e570c8-e463-45c2-aae9-a960146bc5d5
 */

import React from "react";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface LoaderRootProps
  extends React.ComponentProps<typeof SubframeCore.Loader> {
  size?: "small" | "medium" | "large";
  light?: boolean;
  className?: string;
}

const LoaderRoot = React.forwardRef<
  React.ElementRef<typeof SubframeCore.Loader>,
  LoaderRootProps
>(function LoaderRoot(
  { size = "medium", light = false, className, ...otherProps }: LoaderRootProps,
  ref
) {
  return (
    <SubframeCore.Loader
      className={SubframeUtils.twClassNames(
        "group/f2e570c8 text-body-2 font-body-2 text-brand-500",
        {
          "text-white": light,
          "text-[24px] font-[500] leading-[32px] tracking-tight":
            size === "large",
          "text-caption font-caption": size === "small",
        },
        className
      )}
      ref={ref}
      {...otherProps}
    />
  );
});

export const Loader = LoaderRoot;
