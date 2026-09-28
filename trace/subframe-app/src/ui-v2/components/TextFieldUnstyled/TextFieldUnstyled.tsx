"use client";
/*
 * Documentation:
 * Text Field Unstyled — https://app.subframe.com/de62b029ca8b/library?component=Text+Field+Unstyled_abb07b95-d67f-418c-aea5-aba353cce0d4
 */

import React from "react";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface InputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "placeholder" | "size" | "value"
  > {
  type?: "text" | "password" | "email" | "number" | "tel" | "url" | "search";
  placeholder?: React.ReactNode;
  size?: "medium" | "small" | "large" | "xlarge";
  value?: React.ReactNode;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    type = "text",
    placeholder,
    size = "medium",
    value,
    className,
    ...otherProps
  }: InputProps,
  ref
) {
  return (
    <input
      className={SubframeUtils.twClassNames(
        "group/5ab818fd h-full w-full border-none bg-transparent px-0 py-0 text-body-2 font-body-2 text-default-font outline-none placeholder:text-neutral-400",
        {
          "text-[24px] font-[500] leading-[32px] tracking-tight":
            size === "xlarge",
          "text-[18px] font-[500] leading-[28px] tracking-normal":
            size === "large",
          "text-caption font-caption": size === "small",
        },
        className
      )}
      placeholder={placeholder as string}
      value={value as string}
      ref={ref}
      type={
        type === "search"
          ? "search"
          : type === "url"
          ? "url"
          : type === "tel"
          ? "tel"
          : type === "number"
          ? "number"
          : type === "email"
          ? "email"
          : type === "password"
          ? "password"
          : "text"
      }
      {...otherProps}
    />
  );
});

export interface TextFieldUnstyledRootProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  children?: React.ReactNode;
  className?: string;
}

const TextFieldUnstyledRoot = React.forwardRef<
  HTMLLabelElement,
  TextFieldUnstyledRootProps
>(function TextFieldUnstyledRoot(
  { children, className, ...otherProps }: TextFieldUnstyledRootProps,
  ref
) {
  return children ? (
    <label
      className={SubframeUtils.twClassNames(
        "flex flex-col items-start gap-1",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {children}
    </label>
  ) : null;
});

export const TextFieldUnstyled = Object.assign(TextFieldUnstyledRoot, {
  Input,
});
