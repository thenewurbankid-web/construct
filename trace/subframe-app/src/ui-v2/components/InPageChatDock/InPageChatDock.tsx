"use client";
/*
 * Documentation:
 * Badge — https://app.subframe.com/de62b029ca8b/library?component=Badge_97bdb082-1124-4dd7-a335-b14b822d0157
 * Button — https://app.subframe.com/de62b029ca8b/library?component=Button_3b777358-b86b-40af-9327-891efc6826fe
 * Command Input — https://app.subframe.com/de62b029ca8b/library?component=Command+Input_70c650df-7bcd-40a9-805b-72048082a9ae
 * In Page Chat Dock — https://app.subframe.com/de62b029ca8b/library?component=In+Page+Chat+Dock_4a9cde10-726b-41cb-9f3d-c2be2b329496
 * Max States — https://app.subframe.com/de62b029ca8b/library?component=Max+States_e3215ebb-cac0-4d45-8941-a2c2e1b8beab
 */

import React from "react";
import { FeatherAlignLeft } from "@subframe/core";
import { FeatherArrowUpRight } from "@subframe/core";
import { FeatherCheck } from "@subframe/core";
import { FeatherFileText } from "@subframe/core";
import { FeatherPlay } from "@subframe/core";
import { FeatherShieldCheck } from "@subframe/core";
import { FeatherSparkles } from "@subframe/core";
import * as SubframeUtils from "../../utils";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { CommandInput } from "../CommandInput";
import { MaxStates } from "../MaxStates";

export interface InPageChatDockRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  state?: "idle" | "thinking" | "complete";
  minimized?: boolean;
  contextLabel?: React.ReactNode;
  contextSummary?: React.ReactNode;
  responseText?: React.ReactNode;
  promptEcho?: React.ReactNode;
  statusText?: React.ReactNode;
  className?: string;
}

const InPageChatDockRoot = React.forwardRef<
  HTMLDivElement,
  InPageChatDockRootProps
>(function InPageChatDockRoot(
  {
    state = "idle",
    minimized = false,
    contextLabel,
    contextSummary,
    responseText,
    promptEcho,
    statusText,
    className,
    ...otherProps
  }: InPageChatDockRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/4a9cde10 flex cursor-pointer flex-col items-center gap-2 w-[704px] max-w-full",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full items-center justify-between px-3 gap-3",
          { hidden: minimized }
        )}
      >
        <div className="flex min-w-[0px] items-center gap-2">
          <Badge variant="brand">{contextLabel}</Badge>
          {contextSummary ? (
            <span className="line-clamp-1 text-caption font-caption text-neutral-500">
              {contextSummary}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1 group/linkwrap cursor-pointer">
          <span className="whitespace-nowrap text-button-xs font-button-xs text-brand-600 group-hover/4a9cde10:text-brand-700">
            Open full chat
          </span>
          <FeatherArrowUpRight className="text-caption font-caption text-brand-600 group-hover/4a9cde10:text-brand-700" />
        </div>
      </div>
      <div
        className={SubframeUtils.twClassNames(
          "hidden w-full flex-col items-start overflow-hidden rounded-[20px] border border-solid border-alpha-brand-16 bg-default-background shadow-lg",
          { flex: state === "complete" || state === "thinking" }
        )}
      >
        <div className="flex w-full items-center gap-3 border-b border-solid border-neutral-border px-5 py-3">
          <MaxStates
            className="h-8 w-8 flex-none"
            variant={state === "complete" ? "default" : "thinking"}
          />
          <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start">
            <span
              className={SubframeUtils.twClassNames(
                "text-body-2-bold font-body-2-bold text-default-font",
                { hidden: state === "complete" }
              )}
            >
              MAX is working in this page
            </span>
            <span
              className={SubframeUtils.twClassNames(
                "hidden text-body-2-bold font-body-2-bold text-default-font",
                { inline: state === "complete" }
              )}
            >
              MAX
            </span>
            {promptEcho ? (
              <span className="line-clamp-1 text-caption font-caption text-neutral-400 max-w-full">
                {promptEcho}
              </span>
            ) : null}
          </div>
          <Badge
            className={SubframeUtils.twClassNames("hidden", {
              flex: state === "complete",
            })}
            variant="success"
            icon={<FeatherCheck />}
          >
            Grounded
          </Badge>
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "hidden w-full items-center gap-3 px-5 py-5",
            { flex: state === "thinking" }
          )}
        >
          <div className="flex items-center gap-1.5">
            <div className="flex h-1.5 w-1.5 flex-none items-start rounded-full bg-brand-500 animate-bounce [animation-delay:-0.3s]" />
            <div className="flex h-1.5 w-1.5 flex-none items-start rounded-full bg-brand-300 animate-bounce [animation-delay:-0.15s]" />
            <div className="flex h-1.5 w-1.5 flex-none items-start rounded-full bg-brand-100 animate-bounce" />
          </div>
          {statusText ? (
            <span className="text-body-2 font-body-2 text-neutral-500">
              {statusText}
            </span>
          ) : null}
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "hidden w-full flex-col items-start gap-4 px-5 py-5",
            { flex: state === "complete" }
          )}
        >
          {responseText ? (
            <span className="text-body-2 font-body-2 text-default-font">
              {responseText}
            </span>
          ) : null}
          <div className="flex w-full flex-wrap items-center gap-2">
            <Badge variant="neutral" icon={<FeatherShieldCheck />}>
              3 live tool checks
            </Badge>
            <Button
              variant="outline"
              size="xsmall"
              icon={<FeatherFileText />}
              slot={<Badge>Badge</Badge>}
            >
              Create action plan
            </Button>
            <Button
              variant="ghost"
              size="xsmall"
              icon={<FeatherSparkles />}
              slot={<Badge>Badge</Badge>}
            >
              Show evidence
            </Button>
          </div>
        </div>
      </div>
      <div className="flex w-full items-end justify-center relative isolate">
        <CommandInput
          className="relative z-10"
          type="max-focused"
          leftSlot={
            <Button
              variant="error-ghost"
              size="small"
              slot={<Badge>Badge</Badge>}
            >
              Dismiss
            </Button>
          }
          rightSlot={
            <>
              <Button
                variant="outline"
                size="small"
                icon={<FeatherPlay />}
                slot={<Badge>Badge</Badge>}
              >
                Simulate
              </Button>
              <Button
                variant="gradient"
                size="small"
                icon={<FeatherCheck />}
                slot={<Badge>Badge</Badge>}
              >
                Accept
              </Button>
            </>
          }
          slashCommands={
            <>
              <span className="text-overline-xs font-overline-xs text-neutral-500 uppercase px-2 py-1">
                COMMANDS
              </span>
              <CommandInput.CommandRow
                icon={<FeatherAlignLeft />}
                label="Summarize"
                active={true}
              />
            </>
          }
          handle={true}
          footText={
            <span className="text-caption-xs font-caption-xs text-alpha-slate-48 text-center w-[420px] max-w-full">
              MAX uses this page as context and can make mistakes. Check
              important decisions before acting.
            </span>
          }
          voiceTranscript="Show me the opportunities that need my attention today."
          voiceTimer="0:08"
          voiceErrorMessage="I couldn't hear that. Check your microphone and try again."
        />
      </div>
    </div>
  );
});

export const InPageChatDock = InPageChatDockRoot;
