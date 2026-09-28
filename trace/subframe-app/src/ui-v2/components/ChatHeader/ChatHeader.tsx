"use client";
/*
 * Documentation:
 * Chat Header — https://app.subframe.com/de62b029ca8b/library?component=Chat+Header_d433f068-1938-4805-865a-295917565aeb
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface ChatHeaderRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  name?: React.ReactNode;
  subtitle?: React.ReactNode;
  buttons?: React.ReactNode;
  className?: string;
}

const ChatHeaderRoot = React.forwardRef<HTMLDivElement, ChatHeaderRootProps>(
  function ChatHeaderRoot(
    { name, subtitle, buttons, className, ...otherProps }: ChatHeaderRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full items-center gap-4",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex h-12 w-12 flex-none flex-col items-center justify-center gap-2 overflow-hidden rounded-full border border-solid border-neutral-border bg-brand-50 relative">
          <span className="line-clamp-1 w-full font-['Inter_Tight'] text-[18px] font-[500] leading-[18px] text-brand-700 text-center absolute">
            A
          </span>
          <img
            className="h-12 w-12 flex-none object-cover absolute"
            src="https://res.cloudinary.com/subframe/image/upload/v1711417512/shared/btvntvzhdbhpulae3kzk.jpg"
          />
        </div>
        <div className="flex grow shrink-0 basis-0 flex-col items-start">
          {name ? (
            <span className="w-full font-['Inter_Tight'] text-[16px] font-[500] leading-[24px] text-default-font">
              {name}
            </span>
          ) : null}
          {subtitle ? (
            <span className="text-body-2 font-body-2 text-subtext-color">
              {subtitle}
            </span>
          ) : null}
        </div>
        {buttons ? (
          <div className="flex items-start gap-2">{buttons}</div>
        ) : null}
      </div>
    );
  }
);

export const ChatHeader = ChatHeaderRoot;
