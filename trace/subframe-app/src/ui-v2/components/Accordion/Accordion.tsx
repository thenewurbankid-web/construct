"use client";
/*
 * Documentation:
 * Accordion — https://app.subframe.com/de62b029ca8b/library?component=Accordion_d2e81e20-863a-4027-826a-991d8910efd9
 */

import React from "react";
import { FeatherChevronDown } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface ChevronProps
  extends React.ComponentProps<typeof SubframeCore.Collapsible.Chevron> {
  variant?: "xs" | "sm" | "md";
  className?: string;
}

const Chevron = React.forwardRef<
  React.ElementRef<typeof FeatherChevronDown>,
  ChevronProps
>(function Chevron(
  { variant = "xs", className, ...otherProps }: ChevronProps,
  ref
) {
  return (
    <SubframeCore.Collapsible.Chevron {...otherProps}>
      <FeatherChevronDown
        className={SubframeUtils.twClassNames(
          "group/e1d8347b text-body-2 font-body-2 text-default-font",
          { "text-body-1 font-body-1": variant === "md" || variant === "sm" },
          className
        )}
        ref={ref}
      />
    </SubframeCore.Collapsible.Chevron>
  );
});

export interface ContentProps
  extends React.ComponentProps<typeof SubframeCore.Collapsible.Content> {
  children?: React.ReactNode;
  className?: string;
}

const Content = React.forwardRef<HTMLDivElement, ContentProps>(function Content(
  { children, className, ...otherProps }: ContentProps,
  ref
) {
  return children ? (
    <SubframeCore.Collapsible.Content asChild={true} {...otherProps}>
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full flex-col items-start gap-2",
          className
        )}
        ref={ref}
      >
        {children}
      </div>
    </SubframeCore.Collapsible.Content>
  ) : null;
});

export interface TriggerProps
  extends React.ComponentProps<typeof SubframeCore.Collapsible.Trigger> {
  children?: React.ReactNode;
  className?: string;
}

const Trigger = React.forwardRef<HTMLDivElement, TriggerProps>(function Trigger(
  { children, className, ...otherProps }: TriggerProps,
  ref
) {
  return children ? (
    <SubframeCore.Collapsible.Trigger asChild={true} {...otherProps}>
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full cursor-pointer flex-col items-start gap-2",
          className
        )}
        ref={ref}
      >
        {children}
      </div>
    </SubframeCore.Collapsible.Trigger>
  ) : null;
});

export interface AccordionRootProps
  extends React.ComponentProps<typeof SubframeCore.Collapsible.Root> {
  trigger?: React.ReactNode;
  children?: React.ReactNode;
  open?: boolean;
  className?: string;
}

const AccordionRoot = React.forwardRef<HTMLDivElement, AccordionRootProps>(
  function AccordionRoot(
    {
      trigger,
      children,
      open,
      className,
      defaultOpen = false,
      ...otherProps
    }: AccordionRootProps,
    ref
  ) {
    return (
      <SubframeCore.Collapsible.Root
        open={open}
        defaultOpen={defaultOpen}
        asChild={true}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "group/d2e81e20 flex w-full flex-col items-start rounded-rounded-md",
            className
          )}
          ref={ref}
        >
          <Trigger>
            {trigger ? (
              <div className="flex w-full grow shrink-0 basis-0 flex-col items-start group-data-[state=open]/d2e81e20:flex-none">
                {trigger}
              </div>
            ) : null}
          </Trigger>
          <Content>
            {children ? (
              <div className="flex w-full grow shrink-0 basis-0 flex-col items-start">
                {children}
              </div>
            ) : null}
          </Content>
        </div>
      </SubframeCore.Collapsible.Root>
    );
  }
);

export const Accordion = Object.assign(AccordionRoot, {
  Chevron,
  Content,
  Trigger,
});
