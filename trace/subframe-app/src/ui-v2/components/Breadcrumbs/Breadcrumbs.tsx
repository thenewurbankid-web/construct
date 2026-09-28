"use client";
/*
 * Documentation:
 * Breadcrumbs — https://app.subframe.com/de62b029ca8b/library?component=Breadcrumbs_8898334b-a66f-4ee8-8bd1-afcfa8e37cc0
 */

import React from "react";
import { FeatherHome } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface ItemProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  active?: boolean;
  icon?: boolean;
  icon2?: React.ReactNode;
  className?: string;
}

const Item = React.forwardRef<HTMLDivElement, ItemProps>(function Item(
  {
    children,
    active = false,
    icon = false,
    icon2 = <FeatherHome />,
    className,
    ...otherProps
  }: ItemProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/bbdc1640 flex cursor-pointer items-center gap-2",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {icon2 ? (
        <SubframeCore.IconWrapper
          className={SubframeUtils.twClassNames(
            "hidden text-body-2 font-body-2 text-subtext-color",
            { "inline-flex": icon }
          )}
        >
          {icon2}
        </SubframeCore.IconWrapper>
      ) : null}
      {children ? (
        <span
          className={SubframeUtils.twClassNames(
            "line-clamp-1 break-words text-body-2 font-body-2 text-subtext-color group-hover/bbdc1640:text-default-font",
            { "text-body-2-bold font-body-2-bold text-default-font": active }
          )}
        >
          {children}
        </span>
      ) : null}
    </div>
  );
});

export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

const Divider = React.forwardRef<HTMLDivElement, DividerProps>(function Divider(
  { className, ...otherProps }: DividerProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "flex items-center gap-2",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <span className="font-['Inter_Tight'] text-[14px] font-[600] leading-[20px] tracking-tight text-neutral-400">
        /
      </span>
    </div>
  );
});

export interface BreadcrumbsRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
}

const BreadcrumbsRoot = React.forwardRef<HTMLDivElement, BreadcrumbsRootProps>(
  function BreadcrumbsRoot(
    { children, className, ...otherProps }: BreadcrumbsRootProps,
    ref
  ) {
    return children ? (
      <div
        className={SubframeUtils.twClassNames(
          "flex items-center gap-2",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {children}
      </div>
    ) : null;
  }
);

export const Breadcrumbs = Object.assign(BreadcrumbsRoot, {
  Item,
  Divider,
});
