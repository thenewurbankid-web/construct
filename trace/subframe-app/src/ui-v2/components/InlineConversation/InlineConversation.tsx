"use client";
/*
 * Documentation:
 * Badge — https://app.subframe.com/de62b029ca8b/library?component=Badge_97bdb082-1124-4dd7-a335-b14b822d0157
 * Button — https://app.subframe.com/de62b029ca8b/library?component=Button_3b777358-b86b-40af-9327-891efc6826fe
 * Icon Button — https://app.subframe.com/de62b029ca8b/library?component=Icon+Button_af9405b1-8c54-4e01-9786-5aad308224f6
 * Inline Conversation — https://app.subframe.com/de62b029ca8b/library?component=Inline+Conversation_8622fca0-3773-42c1-9c6a-b068ecebb88c
 * Suggestion — https://app.subframe.com/de62b029ca8b/library?component=Suggestion_c5e538eb-4e81-44b6-a6a7-5ae7c8720f3b
 */

import React from "react";
import { FeatherChevronLeft } from "@subframe/core";
import { FeatherChevronRight } from "@subframe/core";
import { FeatherCornerDownRight } from "@subframe/core";
import { FeatherMessageSquare } from "@subframe/core";
import { FeatherPencilLine } from "@subframe/core";
import { FeatherX } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import { Suggestion } from "../Suggestion";

export interface FollowUpItemProps
  extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

const FollowUpItem = React.forwardRef<HTMLDivElement, FollowUpItemProps>(
  function FollowUpItem(
    {
      label,
      icon = <FeatherCornerDownRight />,
      className,
      ...otherProps
    }: FollowUpItemProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full flex-col items-start gap-1.5 overflow-hidden py-2",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex w-full items-start gap-2 px-1">
          <div className="flex h-5 w-5 flex-none items-center justify-center mt-px">
            {icon ? (
              <SubframeCore.IconWrapper className="text-body-1 font-body-1 text-accent-vivid-indigo">
                {icon}
              </SubframeCore.IconWrapper>
            ) : null}
          </div>
          {label ? (
            <span className="min-w-[0px] break-words text-caption font-caption text-neutral-900 grow shrink basis-0">
              {label}
            </span>
          ) : null}
        </div>
        <div className="flex h-px w-full flex-none items-start border-t border-dashed border-neutral-300" />
      </div>
    );
  }
);

export interface InlineConversationRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  state?: "collapsed" | "default" | "active" | "resumable";
  suggestionsLabel?: React.ReactNode;
  exchangeCount?: React.ReactNode;
  question?: React.ReactNode;
  carouselPosition?: React.ReactNode;
  hideCarousel?: boolean;
  suggestions?: React.ReactNode;
  commandInput?: React.ReactNode;
  response?: React.ReactNode;
  followUps?: React.ReactNode;
  className?: string;
}

const InlineConversationRoot = React.forwardRef<
  HTMLDivElement,
  InlineConversationRootProps
>(function InlineConversationRoot(
  {
    state = "collapsed",
    suggestionsLabel,
    exchangeCount,
    question,
    carouselPosition,
    hideCarousel = false,
    suggestions,
    commandInput,
    response,
    followUps,
    className,
    ...otherProps
  }: InlineConversationRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/8622fca0 flex w-full flex-col items-start gap-3 group/inline-conv transition-all duration-300 ease-out",
        {
          "gap-4 rounded-rounded-lg border border-solid border-alpha-brand-4 bg-alpha-brand-4 px-6 py-6 mobile:px-4 mobile:py-4":
            state === "active",
          "gap-4": state === "default",
        },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full flex-wrap items-center gap-2 overflow-hidden content-center transition-all duration-300 ease-out opacity-100 translate-y-0",
          {
            "hidden max-h-[0px] flex-none opacity-0 pointer-events-none scale-y-95":
              state === "active",
          }
        )}
      >
        {suggestionsLabel ? (
          <span
            className={SubframeUtils.twClassNames(
              "whitespace-nowrap text-overline-xs font-overline-xs text-neutral-500 uppercase",
              { hidden: state === "resumable" }
            )}
          >
            {suggestionsLabel}
          </span>
        ) : null}
        <span
          className={SubframeUtils.twClassNames(
            "hidden whitespace-nowrap text-overline-xs font-overline-xs text-neutral-500 uppercase",
            { inline: state === "resumable" }
          )}
        >
          CONTINUE
        </span>
        <div
          className={SubframeUtils.twClassNames(
            "hidden flex-wrap items-center gap-2 pr-7",
            { flex: state === "resumable" }
          )}
        >
          {exchangeCount ? (
            <span
              className={SubframeUtils.twClassNames(
                "hidden text-body-2 font-body-2 text-accent-soft-indigo font-semibold",
                { inline: state === "resumable" }
              )}
            >
              {exchangeCount}
            </span>
          ) : null}
        </div>
        {suggestions ? (
          <div
            className={SubframeUtils.twClassNames(
              "flex flex-wrap items-center gap-2",
              { hidden: state === "resumable" }
            )}
          >
            {suggestions}
          </div>
        ) : null}
        <Suggestion
          className={SubframeUtils.twClassNames({
            hidden: state === "resumable" || state === "default",
          })}
          tone="brand"
          type="custom-prompt"
          label={
            <span className="min-w-[0px] grow shrink-0 basis-0 self-stretch whitespace-nowrap text-body-2-max font-body-2-max text-accent-vivid-indigo overflow-hidden text-ellipsis">
              Ask your own question
            </span>
          }
          icon={<FeatherPencilLine />}
        />
        <Suggestion
          className="hidden"
          tone="neutral"
          type="custom-prompt"
          label={
            <span className="min-w-[0px] grow shrink-0 basis-0 self-stretch whitespace-nowrap text-body-2-max font-body-2-max text-accent-vivid-indigo overflow-hidden text-ellipsis">
              Ask your own question
            </span>
          }
          icon={<FeatherMessageSquare />}
        />
        <Suggestion
          className={SubframeUtils.twClassNames("hidden", {
            flex: state === "resumable",
          })}
          label={
            <span className="min-w-[0px] grow shrink-0 basis-0 self-stretch whitespace-nowrap text-body-2-max font-body-2-max text-accent-vivid-indigo overflow-hidden text-ellipsis">
              Draft the notice letter
            </span>
          }
        />
        <Suggestion
          className={SubframeUtils.twClassNames("hidden", {
            flex: state === "resumable",
          })}
          tone="neutral"
          type="custom-prompt"
          label={
            <span className="min-w-[0px] grow shrink-0 basis-0 self-stretch whitespace-nowrap text-body-2-max font-body-2-max text-accent-vivid-indigo overflow-hidden text-ellipsis">
              Ask your own question
            </span>
          }
          icon={<FeatherMessageSquare />}
        />
      </div>
      <div
        className={SubframeUtils.twClassNames(
          "hidden max-h-[0px] w-full items-center gap-3 overflow-hidden py-1.5 transition-all duration-300 ease-out opacity-0 pointer-events-none translate-y-1",
          {
            "flex max-h-[96px] flex-none opacity-100 pointer-events-auto translate-y-0":
              state === "active",
          }
        )}
      >
        <div
          className={SubframeUtils.twClassNames("flex items-center gap-3", {
            hidden: hideCarousel,
          })}
        >
          <IconButton
            variant={state === "active" ? "outline" : undefined}
            size={state === "active" ? "small" : undefined}
            icon={state === "active" ? <FeatherChevronLeft /> : undefined}
          />
          <IconButton
            variant={state === "active" ? "outline" : undefined}
            size={state === "active" ? "small" : undefined}
            icon={state === "active" ? <FeatherChevronRight /> : undefined}
          />
          {carouselPosition ? (
            <span className="text-caption-mono font-caption-mono text-neutral-700 uppercase">
              {carouselPosition}
            </span>
          ) : null}
        </div>
        <div className="flex grow shrink-0 basis-0 items-start" />
        <Button
          variant="outline"
          size="small"
          icon={<FeatherX />}
          slot={<Badge>Badge</Badge>}
        >
          {state === "active" ? "Close" : "Button"}
        </Button>
      </div>
      <div
        className={SubframeUtils.twClassNames(
          "hidden max-h-[0px] w-full items-start gap-6 pb-7 transition-all duration-300 ease-out opacity-0 pointer-events-none translate-y-2",
          {
            "flex max-h-[2000px] flex-none px-0 py-0 opacity-100 pointer-events-auto translate-y-0":
              state === "active",
          }
        )}
      >
        <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start gap-4">
          {question ? (
            <span className="w-full text-h6 font-h6 text-accent-soft-indigo transition-opacity duration-300 ease-out delay-75">
              {question}
            </span>
          ) : null}
          <div className="flex w-full items-start gap-4 tablet:flex-col">
            {response ? (
              <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start transition-opacity duration-300 ease-out delay-100">
                {response}
              </div>
            ) : null}
            <div className="flex min-w-[180px] max-w-[300px] grow shrink-0 basis-0 flex-col items-start overflow-hidden transition-opacity duration-300 ease-out delay-150 tablet:min-w-[0px] tablet:flex-none tablet:transition-opacity tablet:duration-300 tablet:ease-out tablet:delay-150 tablet:max-w-full">
              <span className="whitespace-nowrap text-overline-xs font-overline-xs text-neutral-500 uppercase">
                FOLLOW UP
              </span>
              {followUps ? (
                <div className="flex w-full flex-col items-start">
                  {followUps}
                </div>
              ) : null}
            </div>
          </div>
          {commandInput ? (
            <div
              className={SubframeUtils.twClassNames(
                "flex max-h-[0px] w-full max-w-[1280px] grow shrink-0 basis-0 flex-col items-center gap-2 transition-all duration-300 ease-out opacity-0 pointer-events-none translate-y-1",
                {
                  "max-h-none max-w-none flex-none items-start opacity-100 pointer-events-auto translate-y-0":
                    state === "active",
                  "max-h-[500px] max-w-none flex-none opacity-100 pointer-events-auto translate-y-0":
                    state === "default",
                }
              )}
            >
              {commandInput}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

export const InlineConversation = Object.assign(InlineConversationRoot, {
  FollowUpItem,
});
