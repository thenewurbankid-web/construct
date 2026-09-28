"use client";
/*
 * Documentation:
 * Button — https://app.subframe.com/de62b029ca8b/library?component=Button_3b777358-b86b-40af-9327-891efc6826fe
 * SetupFooterBar — https://app.subframe.com/de62b029ca8b/library?component=SetupFooterBar_42dba042-6b80-4412-abe6-169310bb6ebb
 */

import React from "react";
import * as SubframeUtils from "../../utils";
import { Button } from "../Button";

export interface SetupFooterBarRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  helperText?: React.ReactNode;
  backLabel?: React.ReactNode;
  primaryLabel?: React.ReactNode;
  hideBack?: boolean;
  className?: string;
}

const SetupFooterBarRoot = React.forwardRef<
  HTMLDivElement,
  SetupFooterBarRootProps
>(function SetupFooterBarRoot(
  {
    helperText,
    backLabel,
    primaryLabel,
    hideBack = false,
    className,
    ...otherProps
  }: SetupFooterBarRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/42dba042 flex w-full items-center justify-between border-t border-solid border-neutral-200 bg-default-background px-10 py-5 mobile:flex-col mobile:gap-3 mobile:px-4 mobile:items-stretch",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {helperText ? (
        <span className="text-body-2 font-body-2 text-neutral-600">
          {helperText}
        </span>
      ) : null}
      <div className="flex items-center gap-3 mobile:flex-col">
        <Button
          className={SubframeUtils.twClassNames(
            "h-12 w-auto flex-none px-8 mobile:w-full",
            { hidden: hideBack }
          )}
          variant="secondary"
        >
          {backLabel}
        </Button>
        <Button
          className="h-12 w-auto flex-none px-8 mobile:w-full"
          variant="primary"
        >
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
});

export const SetupFooterBar = SetupFooterBarRoot;
