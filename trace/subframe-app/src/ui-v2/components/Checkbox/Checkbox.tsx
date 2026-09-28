"use client";
/*
 * Documentation:
 * Checkbox — https://app.subframe.com/de62b029ca8b/library?component=Checkbox_3816e3b5-c48c-499b-b45e-0777c6972523
 */

import React from "react";
import { FeatherCheck } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface CheckboxRootProps
  extends React.ComponentProps<typeof SubframeCore.Checkbox.Root> {
  label?: React.ReactNode;
  disabled?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
}

const CheckboxRoot = React.forwardRef<HTMLButtonElement, CheckboxRootProps>(
  function CheckboxRoot(
    {
      label,
      disabled = false,
      checked = false,
      className,
      ...otherProps
    }: CheckboxRootProps,
    ref
  ) {
    return (
      <SubframeCore.Checkbox.Root
        checked={checked}
        disabled={disabled}
        asChild={true}
        {...otherProps}
      >
        <button
          className={SubframeUtils.twClassNames(
            "group/3816e3b5 flex cursor-pointer items-center gap-2 text-left",
            className
          )}
          ref={ref}
        >
          <div className="flex h-6 w-6 flex-none flex-col items-center justify-center gap-2 rounded-[6px] border-2 border-solid border-neutral-300 bg-default-background group-active/3816e3b5:border-2 group-active/3816e3b5:border-solid group-active/3816e3b5:border-brand-500 group-focus-within/3816e3b5:border-2 group-focus-within/3816e3b5:border-solid group-focus-within/3816e3b5:border-brand-500 group-aria-[checked=true]/3816e3b5:border group-aria-[checked=true]/3816e3b5:border-solid group-aria-[checked=true]/3816e3b5:border-brand-500 group-aria-[checked=true]/3816e3b5:bg-brand-500 group-active/3816e3b5:group-aria-[checked=true]/3816e3b5:border-2 group-active/3816e3b5:group-aria-[checked=true]/3816e3b5:border-solid group-active/3816e3b5:group-aria-[checked=true]/3816e3b5:border-brand-400 group-active/3816e3b5:group-aria-[checked=true]/3816e3b5:bg-brand-400 group-focus-within/3816e3b5:group-aria-[checked=true]/3816e3b5:border-2 group-focus-within/3816e3b5:group-aria-[checked=true]/3816e3b5:border-solid group-focus-within/3816e3b5:group-aria-[checked=true]/3816e3b5:border-brand-400 group-focus-within/3816e3b5:group-aria-[checked=true]/3816e3b5:bg-brand-400 group-disabled/3816e3b5:border-2 group-disabled/3816e3b5:border-solid group-disabled/3816e3b5:border-neutral-200 group-disabled/3816e3b5:bg-neutral-100 group-active/3816e3b5:group-disabled/3816e3b5:border-2 group-active/3816e3b5:group-disabled/3816e3b5:border-solid group-active/3816e3b5:group-disabled/3816e3b5:border-neutral-200">
            <FeatherCheck className="hidden font-['Inter_Tight'] text-[14px] font-[900] leading-[14px] text-white group-aria-[checked=true]/3816e3b5:inline-flex group-aria-[checked=true]/3816e3b5:font-[600] group-aria-[checked=true]/3816e3b5:tracking-normal group-disabled/3816e3b5:text-neutral-400" />
          </div>
          {label ? (
            <span className="text-body-2 font-body-2 text-default-font group-disabled/3816e3b5:text-subtext-color">
              {label}
            </span>
          ) : null}
        </button>
      </SubframeCore.Checkbox.Root>
    );
  }
);

export const Checkbox = CheckboxRoot;
