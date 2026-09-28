"use client";
/*
 * Documentation:
 * Max States — https://app.subframe.com/de62b029ca8b/library?component=Max+States_e3215ebb-cac0-4d45-8941-a2c2e1b8beab
 * TextSelectionMenu — https://app.subframe.com/de62b029ca8b/library?component=TextSelectionMenu_9bda9b0a-00ca-48d8-9faa-807e7d79f880
 */

import React from "react";
import { FeatherLink2 } from "@subframe/core";
import { FeatherShieldCheck } from "@subframe/core";
import { FeatherSparkles } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";
import { MaxStates } from "../MaxStates";

export interface ActionButtonProps
  extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  children?: React.ReactNode;
  children2?: React.ReactNode;
  className?: string;
}

const ActionButton = React.forwardRef<HTMLDivElement, ActionButtonProps>(
  function ActionButton(
    {
      icon = <FeatherSparkles />,
      children,
      children2,
      className,
      ...otherProps
    }: ActionButtonProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/812b0ecf flex h-6 cursor-pointer items-center gap-1.5 rounded-rounded-xs px-2 whitespace-nowrap border-0 font-button-xs text-default-font transition-colors hover:bg-alpha-brand-8 active:bg-alpha-slate-16 focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-brand-500",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {children2 ? (
          <div className="flex items-center gap-2">{children2}</div>
        ) : null}
        {children ? (
          <span className="text-caption-xs font-caption-xs text-default-font">
            {children}
          </span>
        ) : null}
      </div>
    );
  }
);

export interface TextSelectionMenuRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  askLabel?: React.ReactNode;
  sourcesLabel?: React.ReactNode;
  verifyLabel?: React.ReactNode;
  placement?: "above" | "below";
  className?: string;
}

const TextSelectionMenuRoot = React.forwardRef<
  HTMLDivElement,
  TextSelectionMenuRootProps
>(function TextSelectionMenuRoot(
  {
    askLabel,
    sourcesLabel,
    verifyLabel,
    placement = "above",
    className,
    ...otherProps
  }: TextSelectionMenuRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/9bda9b0a flex items-center gap-1 rounded-rounded-sm border border-solid border-alpha-slate-4 px-1 py-1 shadow-lg max-w-full overflow-x-auto bg-default-background/95 backdrop-blur-md origin-[50%_100%]",
        { "origin-[50%_0%]": placement === "below" },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <ActionButton
        icon={<FeatherSparkles />}
        children2={<MaxStates className="h-4 w-3.5 flex-none" />}
      >
        {askLabel}
      </ActionButton>
      <ActionButton
        icon={<FeatherLink2 />}
        children2={
          <FeatherLink2 className="text-caption-xs font-caption-xs text-default-font" />
        }
      >
        {sourcesLabel}
      </ActionButton>
      <ActionButton
        icon={<FeatherShieldCheck />}
        children2={
          <FeatherShieldCheck className="text-caption-xs font-caption-xs text-default-font" />
        }
      >
        {verifyLabel}
      </ActionButton>
    </div>
  );
});

export const TextSelectionMenu = Object.assign(TextSelectionMenuRoot, {
  ActionButton,
});
