"use client";
/*
 * Documentation:
 * Accordion — https://app.subframe.com/de62b029ca8b/library?component=Accordion_d2e81e20-863a-4027-826a-991d8910efd9
 * Chat Channels Menu — https://app.subframe.com/de62b029ca8b/library?component=Chat+Channels+Menu_9f9e357a-0cd0-4dca-b155-8b6e30cce3cf
 * Icon Button — https://app.subframe.com/de62b029ca8b/library?component=Icon+Button_af9405b1-8c54-4e01-9786-5aad308224f6
 */

import React from "react";
import { FeatherFile } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";
import { Accordion } from "../Accordion";
import { IconButton } from "../IconButton";

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
  { children, label, icon = null, className, ...otherProps }: FolderProps,
  ref
) {
  return (
    <Accordion
      className={SubframeUtils.twClassNames(
        "group/05c886b1 cursor-pointer",
        className
      )}
      trigger={
        <div className="flex w-full items-center gap-2 rounded-rounded-md pl-3 pr-4 pt-6 pb-2 group-hover/05c886b1:bg-neutral-50">
          {icon ? (
            <SubframeCore.IconWrapper className="text-body-2 font-body-2 text-default-font">
              {icon}
            </SubframeCore.IconWrapper>
          ) : null}
          {label ? (
            <span className="line-clamp-1 grow shrink-0 basis-0 text-body-2-bold font-body-2-bold text-subtext-color">
              {label}
            </span>
          ) : null}
          <IconButton size="small" />
          <Accordion.Chevron />
        </div>
      }
      defaultOpen={true}
      ref={ref}
      {...otherProps}
    >
      {children ? (
        <div className="flex w-full flex-col items-start gap-1 pt-1">
          {children}
        </div>
      ) : null}
    </Accordion>
  );
});

export interface ItemProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  rightSlot?: React.ReactNode;
  className?: string;
}

const Item = React.forwardRef<HTMLDivElement, ItemProps>(function Item(
  {
    selected = false,
    children,
    icon = <FeatherFile />,
    rightSlot,
    className,
    ...otherProps
  }: ItemProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/eb5db798 flex w-full cursor-pointer items-center gap-2 rounded-rounded-md px-3 py-2 hover:bg-white",
        { "bg-neutral-100 hover:bg-neutral-100": selected },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div className="flex items-center gap-2 rounded-rounded-md border border-solid border-neutral-border bg-default-background px-1 py-1">
        {icon ? (
          <SubframeCore.IconWrapper
            className={SubframeUtils.twClassNames(
              "text-body-2 font-body-2 text-subtext-color",
              { "text-default-font": selected }
            )}
          >
            {icon}
          </SubframeCore.IconWrapper>
        ) : null}
      </div>
      {children ? (
        <span
          className={SubframeUtils.twClassNames(
            "line-clamp-1 grow shrink-0 basis-0 text-body-2 font-body-2 text-subtext-color",
            { "text-body-2-bold font-body-2-bold text-default-font": selected }
          )}
        >
          {children}
        </span>
      ) : null}
      {rightSlot ? (
        <div className="flex flex-col items-start gap-2">{rightSlot}</div>
      ) : null}
    </div>
  );
});

export interface ChatChannelsMenuRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
}

const ChatChannelsMenuRoot = React.forwardRef<
  HTMLDivElement,
  ChatChannelsMenuRootProps
>(function ChatChannelsMenuRoot(
  { children, className, ...otherProps }: ChatChannelsMenuRootProps,
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
});

export const ChatChannelsMenu = Object.assign(ChatChannelsMenuRoot, {
  Folder,
  Item,
});
