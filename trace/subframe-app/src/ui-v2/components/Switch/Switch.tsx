"use client";
/*
 * Documentation:
 * Switch — https://app.subframe.com/de62b029ca8b/library?component=Switch_7a464794-9ea9-4040-b1de-5bfb2ce599d9
 */

import React from "react";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface ThumbProps
  extends React.ComponentProps<typeof SubframeCore.Switch.Thumb> {
  className?: string;
}

const Thumb = React.forwardRef<HTMLDivElement, ThumbProps>(function Thumb(
  { className, ...otherProps }: ThumbProps,
  ref
) {
  return (
    <SubframeCore.Switch.Thumb asChild={true} {...otherProps}>
      <div
        className={SubframeUtils.twClassNames(
          "flex h-5 w-5 flex-col items-start gap-2 rounded-full bg-white shadow-[0px_1px_2px_0px_#11162a0d]",
          className
        )}
        ref={ref}
      />
    </SubframeCore.Switch.Thumb>
  );
});

export interface SwitchRootProps
  extends React.ComponentProps<typeof SubframeCore.Switch.Root> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
}

const SwitchRoot = React.forwardRef<HTMLDivElement, SwitchRootProps>(
  function SwitchRoot(
    { checked = false, className, ...otherProps }: SwitchRootProps,
    ref
  ) {
    return (
      <SubframeCore.Switch.Root
        checked={checked}
        asChild={true}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "group/7a464794 flex h-6 w-11 cursor-pointer flex-col items-start justify-center gap-2 rounded-xl border border-solid border-[#e2e8f033] bg-neutral-200 px-px py-0.5 aria-[checked=true]:bg-brand-500 aria-[checked=true]:bg-gradient-to-b aria-[checked=true]:from-neutral-900 aria-[checked=true]:to-neutral-800 aria-[checked=true]:shadow-[inset_2px_0px_8px_2px_rgba(204,213,224,0.2)]",
            className
          )}
          ref={ref}
        >
          <Thumb />
        </div>
      </SubframeCore.Switch.Root>
    );
  }
);

export const Switch = Object.assign(SwitchRoot, {
  Thumb,
});
