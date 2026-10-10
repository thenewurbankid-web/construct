"use client";
/*
 * Documentation:
 * Text Field — https://app.subframe.com/de62b029ca8b/library?component=Text+Field_be48ca43-f8e7-4c0e-8870-d219ea11abfe
 */

import React from "react";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface InputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "placeholder" | "value"
  > {
  type?: "text" | "password" | "email" | "number" | "tel" | "url" | "search";
  placeholder?: React.ReactNode;
  value?: React.ReactNode;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { type = "text", placeholder, value, className, ...otherProps }: InputProps,
  ref
) {
  return (
    <input
      className={SubframeUtils.twClassNames(
        "group/b0d608f7 h-full w-full border-none bg-transparent px-0 py-0 text-button font-button text-neutral-800 outline-none placeholder:text-neutral-500 placeholder:truncate placeholder:overflow-hidden placeholder:whitespace-nowrap",
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

export interface TextFieldRootProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  disabled?: boolean;
  error?: boolean;
  variant?: "outline" | "filled";
  label?: React.ReactNode;
  helpText?: React.ReactNode;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  children?: React.ReactNode;
  placeholder?: React.ReactNode;
  size?: "base" | "small";
  required?: boolean;
  className?: string;
}

const TextFieldRoot = React.forwardRef<HTMLLabelElement, TextFieldRootProps>(
  function TextFieldRoot(
    {
      disabled = false,
      error = false,
      variant = "outline",
      label,
      helpText,
      icon = null,
      iconRight = null,
      children,
      placeholder,
      size = "base",
      required = false,
      className,
      ...otherProps
    }: TextFieldRootProps,
    ref
  ) {
    return (
      <label
        className={SubframeUtils.twClassNames(
          "group/be48ca43 flex w-full flex-col items-start gap-2",
          { "opacity-50 cursor-not-allowed": disabled },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex items-center gap-0.5">
          {label ? (
            <span className="text-subtitle-2 font-subtitle-2 text-neutral-700">
              {label}
            </span>
          ) : null}
          <span
            className={SubframeUtils.twClassNames(
              "hidden text-subtitle-2 font-subtitle-2 text-error-600",
              { inline: required }
            )}
          >
            *
          </span>
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "flex h-12 w-full flex-none items-center gap-3 rounded-rounded-sm border-2 border-solid border-neutral-border bg-default-background px-4 focus-within:border-neutral-600",
            {
              "h-10 gap-2 px-2": size === "small",
              "border-2 border-solid border-neutral-100 bg-neutral-100":
                variant === "filled",
              "border-2 border-solid border-error-600": error,
              "border-2 border-solid border-neutral-200 bg-neutral-200 pointer-events-none":
                disabled,
            }
          )}
        >
          {icon ? (
            <SubframeCore.IconWrapper className="font-body-1 text-neutral-700 text-[20px] leading-[20px]">
              {icon}
            </SubframeCore.IconWrapper>
          ) : null}
          {children ? (
            <div className="flex grow shrink-0 basis-0 flex-col items-start self-stretch">
              {children}
            </div>
          ) : null}
          {iconRight ? (
            <SubframeCore.IconWrapper
              className={SubframeUtils.twClassNames(
                "font-body-1 text-neutral-700 text-[20px] leading-[20px]",
                { "text-error-500": error }
              )}
            >
              {iconRight}
            </SubframeCore.IconWrapper>
          ) : null}
        </div>
        {helpText ? (
          <span
            className={SubframeUtils.twClassNames(
              "text-caption font-caption text-neutral-600",
              { "text-error-700": error }
            )}
          >
            {helpText}
          </span>
        ) : null}
      </label>
    );
  }
);

export const TextField = Object.assign(TextFieldRoot, {
  Input,
});
