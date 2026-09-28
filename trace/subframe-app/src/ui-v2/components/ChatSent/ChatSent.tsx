"use client";
/*
 * Documentation:
 * Chat Sent — https://app.subframe.com/de62b029ca8b/library?component=Chat+Sent_8206bfc1-a590-434f-9706-c81a8bc60827
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface ChatSentRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  name?: React.ReactNode;
  message?: React.ReactNode;
  timestamp?: React.ReactNode;
  variant?: "default";
  files?: boolean;
  item?: boolean;
  files2?: React.ReactNode;
  objectEmbed?: React.ReactNode;
  className?: string;
}

const ChatSentRoot = React.forwardRef<HTMLDivElement, ChatSentRootProps>(
  function ChatSentRoot(
    {
      name,
      message,
      timestamp,
      variant = "default",
      files = false,
      item = false,
      files2,
      objectEmbed,
      className,
      ...otherProps
    }: ChatSentRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/8206bfc1 flex w-full flex-col items-end gap-2 pl-6 pb-6",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex flex-col items-end justify-center gap-1.5">
          <div className="flex max-w-[576px] flex-col items-start justify-center gap-1.5 rounded-2xl border border-solid border-alpha-brand-8 bg-alpha-brand-8 px-2 py-2 rounded-br-md">
            {files2 ? (
              <div
                className={SubframeUtils.twClassNames(
                  "hidden w-full flex-col items-start justify-center gap-1.5",
                  { flex: files }
                )}
              >
                {files2}
              </div>
            ) : null}
            {objectEmbed ? (
              <div
                className={SubframeUtils.twClassNames(
                  "hidden w-full flex-col items-start justify-center gap-1.5",
                  { flex: item }
                )}
              >
                {objectEmbed}
              </div>
            ) : null}
            <div className="flex w-full flex-col items-start justify-center gap-1.5 px-2 py-2">
              {message ? (
                <span className="text-body-2 font-body-2 text-neutral-800">
                  {message}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

export const ChatSent = ChatSentRoot;
