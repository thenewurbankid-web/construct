"use client";
/*
 * Documentation:
 * Accordion — https://app.subframe.com/de62b029ca8b/library?component=Accordion_d2e81e20-863a-4027-826a-991d8910efd9
 * Tree View — https://app.subframe.com/de62b029ca8b/library?component=Tree+View_4ed46422-ecc3-41e8-8787-e55ee10cdc75
 */

import React from "react";
import { FeatherFile } from "@subframe/core";
import { FeatherFolder } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";
import { Accordion } from "../Accordion";

export interface FolderProps extends React.ComponentProps<typeof Accordion> {
  children?: React.ReactNode;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

const Folder = React.forwardRef<
  React.ElementRef<typeof Accordion>,
  FolderProps
>(function Folder(
  {
    children,
    label,
    icon = <FeatherFolder />,
    className,
    ...otherProps
  }: FolderProps,
  ref
) {
  return (
    <Accordion
      className={SubframeUtils.twClassNames(
        "group/c841484c cursor-pointer",
        className
      )}
      trigger={
        <div className="flex w-full items-center gap-2 rounded-rounded-md px-3 py-2 group-hover/c841484c:bg-neutral-50">
          {icon ? (
            <SubframeCore.IconWrapper className="text-body-2 font-body-2 text-default-font">
              {icon}
            </SubframeCore.IconWrapper>
          ) : null}
          {label ? (
            <span className="line-clamp-1 grow shrink-0 basis-0 text-body-2 font-body-2 text-default-font">
              {label}
            </span>
          ) : null}
          <Accordion.Chevron />
        </div>
      }
      defaultOpen={true}
      ref={ref}
      {...otherProps}
    >
      {children ? (
        <div className="flex w-full flex-col items-start gap-1 pl-6 pt-1">
          {children}
        </div>
      ) : null}
    </Accordion>
  );
});

export interface ItemProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

const Item = React.forwardRef<HTMLDivElement, ItemProps>(function Item(
  {
    selected = false,
    label,
    icon = <FeatherFile />,
    className,
    ...otherProps
  }: ItemProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/42786044 flex w-full cursor-pointer items-center gap-2 rounded-rounded-md px-3 py-2 hover:bg-neutral-50",
        { "bg-neutral-50": selected },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {icon ? (
        <SubframeCore.IconWrapper
          className={SubframeUtils.twClassNames(
            "text-body-2 font-body-2 text-default-font",
            { "text-neutral-600": selected }
          )}
        >
          {icon}
        </SubframeCore.IconWrapper>
      ) : null}
      {label ? (
        <span
          className={SubframeUtils.twClassNames(
            "line-clamp-1 grow shrink-0 basis-0 text-body-2 font-body-2 text-default-font",
            { "text-neutral-600": selected }
          )}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
});

export interface TreeViewRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
}

const TreeViewRoot = React.forwardRef<HTMLDivElement, TreeViewRootProps>(
  function TreeViewRoot(
    { children, className, ...otherProps }: TreeViewRootProps,
    ref
  ) {
    return children ? (
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full flex-col items-start",
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

export const TreeView = Object.assign(TreeViewRoot, {
  Folder,
  Item,
});
