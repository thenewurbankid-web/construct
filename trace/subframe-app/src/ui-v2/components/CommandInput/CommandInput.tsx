"use client";
/*
 * Documentation:
 * Badge — https://app.subframe.com/de62b029ca8b/library?component=Badge_97bdb082-1124-4dd7-a335-b14b822d0157
 * Button — https://app.subframe.com/de62b029ca8b/library?component=Button_3b777358-b86b-40af-9327-891efc6826fe
 * Command Input — https://app.subframe.com/de62b029ca8b/library?component=Command+Input_70c650df-7bcd-40a9-805b-72048082a9ae
 * Icon Button — https://app.subframe.com/de62b029ca8b/library?component=Icon+Button_af9405b1-8c54-4e01-9786-5aad308224f6
 */

import React from "react";
import { FeatherAlignLeft } from "@subframe/core";
import { FeatherArrowLeft } from "@subframe/core";
import { FeatherArrowRight } from "@subframe/core";
import { FeatherArrowUp } from "@subframe/core";
import { FeatherAudioLines } from "@subframe/core";
import { FeatherCheckCircle2 } from "@subframe/core";
import { FeatherExpand } from "@subframe/core";
import { FeatherFile } from "@subframe/core";
import { FeatherGlobe } from "@subframe/core";
import { FeatherMic } from "@subframe/core";
import { FeatherPlus } from "@subframe/core";
import { FeatherRotateCcw } from "@subframe/core";
import { FeatherSparkles } from "@subframe/core";
import { FeatherSquare } from "@subframe/core";
import { FeatherSquareDashedMousePointer } from "@subframe/core";
import { FeatherX } from "@subframe/core";
import { FeatherZap } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { IconButton } from "../IconButton";

export interface AiBarProps extends React.HTMLAttributes<HTMLDivElement> {
  state?: "default" | "max-thinking";
  className?: string;
}

const AiBar = React.forwardRef<HTMLDivElement, AiBarProps>(function AiBar(
  { state = "default", className, ...otherProps }: AiBarProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/e133eb9b flex items-center",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div
        className={SubframeUtils.twClassNames(
          "flex h-3 items-start overflow-hidden rounded-[6px] bg-alpha-brand-48 w-[61px]",
          { hidden: state === "max-thinking" }
        )}
      />
      <div
        className={SubframeUtils.twClassNames(
          "hidden items-center gap-3 pt-1 pb-4 w-[130px]",
          { flex: state === "max-thinking" }
        )}
      >
        <div className="flex h-3 grow shrink-0 basis-0 items-start overflow-hidden rounded-[6px] bg-alpha-brand-48 relative">
          <div className="flex h-3 w-10 flex-none items-start rounded-[6px] bg-accent-vivid-bumble-bee blur-sm absolute left-0 animate-pulse" />
        </div>
      </div>
    </div>
  );
});

export interface InputProps extends React.HTMLAttributes<HTMLDivElement> {
  state?: "default" | "focused" | "expanded";
  placeholder?: React.ReactNode;
  value?: React.ReactNode;
  ghostText?: React.ReactNode;
  commandTag?: React.ReactNode;
  className?: string;
}

const Input = React.forwardRef<HTMLDivElement, InputProps>(function Input(
  {
    state = "default",
    placeholder,
    value,
    ghostText,
    commandTag,
    className,
    ...otherProps
  }: InputProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/05b37caa flex w-full flex-col items-start",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full items-center justify-between overflow-hidden rounded-rounded-sm px-1 py-1",
          { hidden: state === "expanded" || state === "focused" }
        )}
      >
        <div className="flex grow shrink-0 basis-0 items-center gap-4">
          <IconButton size="small" icon={<FeatherExpand />} />
          <div className="flex grow shrink-0 basis-0 items-start relative">
            <input
              className="grow shrink-0 basis-0 self-stretch text-body-2-bold font-body-2-bold text-neutral-900 outline-none placeholder:text-neutral-500 relative"
              placeholder={placeholder}
              value={value}
              type="text"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <IconButton size="small" icon={<FeatherAudioLines />} />
          <IconButton
            disabled={true}
            variant="primary"
            size="small"
            icon={<FeatherArrowUp />}
          />
        </div>
      </div>
      <div
        className={SubframeUtils.twClassNames(
          "hidden w-full flex-col items-start",
          { flex: state === "expanded" || state === "focused" }
        )}
      >
        <div className="flex min-h-[80px] w-full items-start justify-between rounded-rounded-sm px-1 py-1">
          <div className="flex grow shrink-0 basis-0 items-start gap-4">
            <IconButton
              className={SubframeUtils.twClassNames(
                "h-10 w-11 flex-none bg-neutral-100",
                { hidden: state === "expanded" }
              )}
              icon={<FeatherArrowLeft />}
            />
            <div
              className={SubframeUtils.twClassNames(
                "hidden grow shrink-0 basis-0 items-start gap-2 px-2 pt-2",
                { flex: state === "expanded" || state === "focused" }
              )}
            >
              {commandTag ? (
                <div className="flex items-start pt-px">{commandTag}</div>
              ) : null}
              <div className="flex grow shrink-0 basis-0 items-start relative">
                <div className="flex min-h-[80px] items-start pointer-events-none absolute inset-0 whitespace-pre-wrap break-words font-body-2-bold text-transparent">
                  {value ? (
                    <span className="self-stretch text-body-2-bold font-body-2-bold text-default-font">
                      {value}
                    </span>
                  ) : null}
                  {ghostText ? (
                    <span className="self-stretch text-body-2-bold font-body-2-bold text-neutral-400">
                      {ghostText}
                    </span>
                  ) : null}
                </div>
                <textarea
                  className="min-h-[80px] grow shrink-0 basis-0 self-stretch text-body-2-bold font-body-2-bold text-neutral-900 outline-none placeholder:text-neutral-500 relative resize-none"
                  placeholder={placeholder}
                  value={value}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="flex w-full items-start gap-2">
          <div className="flex grow shrink-0 basis-0 items-start gap-1">
            <CommandInput.InputIconButton
              icon={<FeatherSquareDashedMousePointer />}
            />
            <CommandInput.InputIconButton icon={<FeatherPlus />} />
            <CommandInput.InputIconButton icon={<FeatherGlobe />} />
          </div>
          <div className="flex items-start gap-1">
            <CommandInput.InputIconButton icon={<FeatherAudioLines />} />
            <IconButton
              className="h-10 w-10 flex-none"
              variant="primary"
              icon={<FeatherArrowUp />}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

export interface InputIconButtonProps
  extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  showIndicator?: boolean;
  state?: "default" | "active";
  className?: string;
}

const InputIconButton = React.forwardRef<HTMLDivElement, InputIconButtonProps>(
  function InputIconButton(
    {
      icon = <FeatherSquareDashedMousePointer />,
      showIndicator = false,
      state = "default",
      className,
      ...otherProps
    }: InputIconButtonProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/b67e38d6 flex h-10 w-10 cursor-pointer items-center justify-center gap-2 rounded-rounded-sm border-2 border-solid border-alpha-white-48 bg-alpha-slate-4 text-left relative hover:bg-alpha-slate-8",
          { "bg-alpha-brand-8 hover:bg-alpha-brand-8": state === "active" },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "hidden h-1.5 w-1.5 flex-none items-start rounded-full bg-brand-400 absolute -top-0.5 -right-0.5 z-10",
            { flex: showIndicator }
          )}
        />
        {icon ? (
          <SubframeCore.IconWrapper
            className={SubframeUtils.twClassNames(
              "font-['Inter_Tight'] text-[16px] font-[400] leading-[16px] text-subtext-color",
              { "text-brand-500": state === "active" }
            )}
          >
            {icon}
          </SubframeCore.IconWrapper>
        ) : null}
      </div>
    );
  }
);

export interface FileTagProps extends React.HTMLAttributes<HTMLDivElement> {
  fileIcon?: React.ReactNode;
  fileName?: React.ReactNode;
  onRemove?: React.ReactNode;
  className?: string;
}

const FileTag = React.forwardRef<HTMLDivElement, FileTagProps>(function FileTag(
  {
    fileIcon = <FeatherFile />,
    fileName,
    onRemove,
    className,
    ...otherProps
  }: FileTagProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "items-center gap-2 rounded-rounded-xs border border-solid border-alpha-brand-24 bg-alpha-brand-8 px-2 py-1 inline-flex",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {fileIcon ? (
        <SubframeCore.IconWrapper className="font-['Inter_Tight'] text-[14px] font-[400] leading-[14px] text-alpha-brand-96">
          {fileIcon}
        </SubframeCore.IconWrapper>
      ) : null}
      {fileName ? (
        <span className="text-caption font-caption text-neutral-900">
          {fileName}
        </span>
      ) : null}
      {onRemove ? (
        <div className="flex items-center gap-2">{onRemove}</div>
      ) : null}
    </div>
  );
});

export interface CommandRowProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  label?: React.ReactNode;
  active?: boolean;
  className?: string;
}

const CommandRow = React.forwardRef<HTMLDivElement, CommandRowProps>(
  function CommandRow(
    {
      icon = <FeatherAlignLeft />,
      label,
      active = false,
      className,
      ...otherProps
    }: CommandRowProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/8f8caf15 flex w-full cursor-pointer items-center gap-3 rounded-rounded-sm px-2 py-2 hover:bg-alpha-slate-8",
          { "bg-alpha-slate-8": active },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex h-6 w-6 flex-none items-center justify-center rounded-rounded-sm bg-neutral-100">
          {icon ? (
            <SubframeCore.IconWrapper className="text-body-2 font-body-2 text-neutral-900">
              {icon}
            </SubframeCore.IconWrapper>
          ) : null}
        </div>
        {label ? (
          <span className="text-body-2 font-body-2 text-default-font">
            {label}
          </span>
        ) : null}
      </div>
    );
  }
);

export interface CommandTagProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  label?: React.ReactNode;
  className?: string;
}

const CommandTag = React.forwardRef<HTMLDivElement, CommandTagProps>(
  function CommandTag(
    { icon = <FeatherZap />, label, className, ...otherProps }: CommandTagProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/23229d21 cursor-pointer items-center gap-2 rounded-rounded-xs border border-solid border-alpha-brand-24 bg-alpha-brand-8 px-2 py-1 group/commandtag inline-flex hover:bg-alpha-brand-16 hover:border-alpha-brand-48",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {icon ? (
          <SubframeCore.IconWrapper className="font-['Inter_Tight'] text-[14px] font-[400] leading-[14px] text-alpha-brand-96">
            {icon}
          </SubframeCore.IconWrapper>
        ) : null}
        {label ? (
          <span className="text-caption font-caption text-neutral-900">
            {label}
          </span>
        ) : null}
        <FeatherX className="font-['Inter_Tight'] text-[12px] font-[400] leading-[12px] text-neutral-500 group-hover/23229d21:text-neutral-900" />
      </div>
    );
  }
);

export interface CommandInputRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  type?:
    | "max"
    | "max-focused"
    | "action"
    | "loading"
    | "error"
    | "with-content"
    | "slash-command"
    | "with-attachment"
    | "with-context"
    | "max-focused-2"
    | "voice-listening"
    | "voice-review"
    | "voice-error"
    | "with-command";
  minimized?: boolean;
  showInsight?: boolean;
  showToggle?: boolean;
  showAlertCheck?: boolean;
  showBadge?: boolean;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  slashCommands?: React.ReactNode;
  handle?: boolean;
  footText?: React.ReactNode;
  voiceTranscript?: React.ReactNode;
  voiceTimer?: React.ReactNode;
  voiceErrorMessage?: React.ReactNode;
  className?: string;
}

const CommandInputRoot = React.forwardRef<
  HTMLDivElement,
  CommandInputRootProps
>(function CommandInputRoot(
  {
    type = "max",
    minimized = false,
    showInsight = false,
    showToggle = false,
    showAlertCheck = false,
    showBadge = false,
    leftSlot,
    rightSlot,
    slashCommands,
    handle = false,
    footText,
    voiceTranscript,
    voiceTimer,
    voiceErrorMessage,
    className,
    ...otherProps
  }: CommandInputRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/70c650df flex flex-col items-center gap-2 w-[704px] max-w-full",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <AiBar
        className={SubframeUtils.twClassNames("hidden", { flex: handle })}
      />
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full flex-col items-center gap-2 relative",
          { hidden: minimized }
        )}
      >
        <div
          className={SubframeUtils.twClassNames(
            "hidden h-24 w-full flex-none items-center gap-5 rounded-rounded-md bg-accent-vivid-fuchsia px-5 pt-3 absolute",
            { flex: showInsight }
          )}
        />
        <div
          className={SubframeUtils.twClassNames(
            "hidden w-full items-center gap-5 rounded-rounded-md px-5 pt-3 z-10",
            { flex: showInsight }
          )}
        >
          <div className="flex grow shrink-0 basis-0 items-center gap-2">
            <span className="text-overline-xs font-overline-xs text-white-alt uppercase opacity-80">
              HEADS UP
            </span>
            <span className="line-clamp-1 grow shrink-0 basis-0 text-caption font-caption text-white-alt">
              This opportunity has been impacted by an alert — review before
              accepting
            </span>
          </div>
          <div className="flex items-center gap-2">
            <FeatherCheckCircle2
              className={SubframeUtils.twClassNames(
                "hidden font-['Inter_Tight'] text-[16px] font-[400] leading-[16px] text-white-alt",
                { "inline-flex": showAlertCheck }
              )}
            />
            <span className="font-['Inter_Tight'] text-[12px] font-[600] leading-[16px] text-white-alt">
              View Alert
            </span>
            <div
              className={SubframeUtils.twClassNames("hidden items-start", {
                flex: showBadge,
              })}
            >
              <Badge
                className="h-auto w-auto flex-none self-stretch"
                variant="neutral"
                size="xs"
              >
                2
              </Badge>
            </div>
            <FeatherArrowRight className="text-caption font-caption text-white-alt" />
          </div>
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "flex w-full flex-col items-start gap-2 rounded-[20px] border border-solid border-alpha-slate-8 bg-bg-white px-2 py-1.5 shadow-md z-10",
            {
              hidden: minimized,
              "rounded-rounded-md border border-solid border-error-600":
                type === "error",
            }
          )}
        >
          <div
            className={SubframeUtils.twClassNames(
              "hidden h-52 w-full flex-none flex-col items-start gap-1 rounded-rounded-md bg-alpha-slate-4 px-2 py-2",
              { flex: type === "slash-command" }
            )}
          >
            {slashCommands ? (
              <div
                className={SubframeUtils.twClassNames(
                  "hidden w-full grow shrink-0 basis-0 flex-col items-start gap-1 overflow-y-auto scrollbar-thin",
                  { flex: type === "slash-command" }
                )}
              >
                {slashCommands}
              </div>
            ) : null}
          </div>
          <div
            className={SubframeUtils.twClassNames(
              "hidden w-full items-start px-2 py-1",
              { flex: type === "with-attachment" }
            )}
          >
            <FileTag
              fileIcon={<FeatherFile />}
              fileName="Q3_Report.pdf"
              onRemove={
                <FeatherX className="font-['Inter_Tight'] text-[12px] font-[400] leading-[12px] text-neutral-500 cursor-pointer" />
              }
            />
          </div>
          <Input
            className={SubframeUtils.twClassNames({
              hidden:
                type === "voice-error" ||
                type === "voice-review" ||
                type === "voice-listening" ||
                type === "loading" ||
                type === "action",
            })}
            state={
              type === "with-command"
                ? "focused"
                : type === "max-focused-2"
                ? "expanded"
                : type === "with-context"
                ? "focused"
                : type === "with-attachment"
                ? "focused"
                : type === "slash-command"
                ? "focused"
                : type === "max-focused"
                ? "focused"
                : "default"
            }
            placeholder={
              type === "with-command"
                ? "Add any detail, or send as is"
                : "Ask about this page, or / for commands"
            }
            value={
              type === "with-command"
                ? "focus on the barley lanes"
                : type === "slash-command"
                ? "/su"
                : type === "with-content"
                ? "Summarize the key risks in this opportunity"
                : ""
            }
            ghostText={type === "slash-command" ? "mmarize" : ""}
          />
          <div
            className={SubframeUtils.twClassNames(
              "hidden w-full items-center gap-2 px-2 py-1",
              { flex: type === "error" }
            )}
          >
            <div className="flex h-1.5 w-1.5 flex-none items-start rounded-full bg-error-600" />
            <span className="text-caption font-caption text-error-600">
              Something went wrong — please try again
            </span>
          </div>
          <div
            className={SubframeUtils.twClassNames(
              "hidden w-full items-center justify-between px-1 py-1",
              { flex: type === "loading" }
            )}
          >
            <div className="flex items-center gap-2 px-4 py-4">
              <div className="flex h-1.5 w-1.5 flex-none items-start rounded-full bg-brand-500 animate-bounce [animation-delay:-0.3s]" />
              <div className="flex h-1.5 w-1.5 flex-none items-start rounded-full bg-brand-300 animate-bounce [animation-delay:-0.15s]" />
              <div className="flex h-1.5 w-1.5 flex-none items-start rounded-full bg-brand-100 animate-bounce" />
            </div>
            <Button
              className={SubframeUtils.twClassNames("hidden", {
                flex: type === "loading",
              })}
              variant="ghost"
              size="small"
              slot={<Badge>Badge</Badge>}
            >
              Cancel
            </Button>
          </div>
          <div
            className={SubframeUtils.twClassNames(
              "hidden w-full items-center justify-between px-1 py-1",
              { flex: type === "action" }
            )}
          >
            {leftSlot ? (
              <div className="flex items-start">{leftSlot}</div>
            ) : null}
            {rightSlot ? (
              <div className="flex items-center gap-2">{rightSlot}</div>
            ) : null}
          </div>
          <div
            className={SubframeUtils.twClassNames(
              "hidden w-full flex-col items-start gap-4 px-3 py-3",
              { flex: type === "voice-listening" }
            )}
          >
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-2 w-2 flex-none items-start rounded-full bg-brand-500 animate-pulse" />
                <span className="text-body-2-bold font-body-2-bold text-default-font">
                  Listening
                </span>
              </div>
              {voiceTimer ? (
                <span className="text-caption-mono font-caption-mono text-neutral-400">
                  {voiceTimer}
                </span>
              ) : null}
            </div>
            <div className="flex w-full items-center justify-center gap-1 py-4">
              <div className="flex h-3 w-1 flex-none items-start rounded-full bg-brand-200 animate-pulse [animation-delay:-0.6s]" />
              <div className="flex h-5 w-1 flex-none items-start rounded-full bg-brand-300 animate-pulse [animation-delay:-0.5s]" />
              <div className="flex h-8 w-1 flex-none items-start rounded-full bg-brand-400 animate-pulse [animation-delay:-0.4s]" />
              <div className="flex h-6 w-1 flex-none items-start rounded-full bg-brand-500 animate-pulse [animation-delay:-0.3s]" />
              <div className="flex h-10 w-1 flex-none items-start rounded-full bg-brand-400 animate-pulse [animation-delay:-0.2s]" />
              <div className="flex h-4 w-1 flex-none items-start rounded-full bg-brand-300 animate-pulse [animation-delay:-0.1s]" />
              <div className="flex h-7 w-1 flex-none items-start rounded-full bg-brand-500 animate-pulse" />
              <div className="flex h-5 w-1 flex-none items-start rounded-full bg-brand-400 animate-pulse [animation-delay:-0.55s]" />
              <div className="flex h-9 w-1 flex-none items-start rounded-full bg-brand-300 animate-pulse [animation-delay:-0.45s]" />
              <div className="flex h-6 w-1 flex-none items-start rounded-full bg-brand-500 animate-pulse [animation-delay:-0.35s]" />
              <div className="flex h-4 w-1 flex-none items-start rounded-full bg-brand-400 animate-pulse [animation-delay:-0.25s]" />
              <div className="flex h-7 w-1 flex-none items-start rounded-full bg-brand-200 animate-pulse [animation-delay:-0.15s]" />
              <div className="flex h-3 w-1 flex-none items-start rounded-full bg-brand-300 animate-pulse [animation-delay:-0.05s]" />
              <div className="flex h-8 w-1 flex-none items-start rounded-full bg-brand-400 animate-pulse [animation-delay:-0.5s]" />
              <div className="flex h-5 w-1 flex-none items-start rounded-full bg-brand-500 animate-pulse [animation-delay:-0.4s]" />
              <div className="flex h-6 w-1 flex-none items-start rounded-full bg-brand-300 animate-pulse [animation-delay:-0.3s]" />
              <div className="flex h-10 w-1 flex-none items-start rounded-full bg-brand-400 animate-pulse [animation-delay:-0.2s]" />
              <div className="flex h-4 w-1 flex-none items-start rounded-full bg-brand-200 animate-pulse [animation-delay:-0.1s]" />
              <div className="flex h-7 w-1 flex-none items-start rounded-full bg-brand-500 animate-pulse [animation-delay:-0.6s]" />
              <div className="flex h-3 w-1 flex-none items-start rounded-full bg-brand-300 animate-pulse [animation-delay:-0.45s]" />
            </div>
            <span className="w-full text-caption font-caption text-neutral-400 text-center">
              Speak naturally — Max will clean up pauses.
            </span>
            <div className="flex w-full items-center justify-between pt-1">
              <Button variant="white" size="small" slot={<Badge>Badge</Badge>}>
                Cancel
              </Button>
              <IconButton variant="primary" icon={<FeatherSquare />} />
            </div>
          </div>
          <div
            className={SubframeUtils.twClassNames(
              "hidden w-full flex-col items-start gap-4 px-3 py-3",
              { flex: type === "voice-review" }
            )}
          >
            <div className="flex items-center gap-2">
              <FeatherCheckCircle2 className="text-caption font-caption text-success-600" />
              <span className="text-body-2-bold font-body-2-bold text-default-font">
                Ready to send
              </span>
            </div>
            <div className="flex w-full flex-col items-start gap-2 rounded-rounded-sm bg-alpha-slate-4 px-4 py-3">
              {voiceTranscript ? (
                <span className="w-full text-body-2 font-body-2 text-default-font">
                  {voiceTranscript}
                </span>
              ) : null}
              <span className="text-caption font-caption text-neutral-400">
                Tap to edit
              </span>
            </div>
            <div className="flex w-full items-center justify-between pt-1">
              <Button
                variant="white"
                size="small"
                icon={<FeatherRotateCcw />}
                slot={<Badge>Badge</Badge>}
              >
                Start over
              </Button>
              <IconButton variant="primary" icon={<FeatherArrowUp />} />
            </div>
          </div>
          <div
            className={SubframeUtils.twClassNames(
              "hidden w-full flex-col items-start gap-4 px-3 py-3",
              { flex: type === "voice-error" }
            )}
          >
            <div className="flex w-full items-start gap-3 rounded-rounded-sm bg-error-50 px-4 py-3">
              <FeatherMic className="text-body-2 font-body-2 text-error-500 flex-none mt-0.5" />
              {voiceErrorMessage ? (
                <span className="grow shrink-0 basis-0 text-body-2 font-body-2 text-error-700">
                  {voiceErrorMessage}
                </span>
              ) : null}
            </div>
            <div className="flex w-full items-center justify-between pt-1">
              <Button variant="white" size="small" slot={<Badge>Badge</Badge>}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="small"
                icon={<FeatherRotateCcw />}
                slot={<Badge>Badge</Badge>}
              >
                Try again
              </Button>
            </div>
          </div>
          <div
            className={SubframeUtils.twClassNames(
              "hidden w-full flex-col items-start gap-2",
              { flex: showToggle }
            )}
          >
            <div
              className={SubframeUtils.twClassNames(
                "hidden h-px w-full flex-none items-start bg-alpha-slate-8",
                { flex: showToggle }
              )}
            />
            <div
              className={SubframeUtils.twClassNames(
                "hidden items-start gap-2",
                { flex: showToggle }
              )}
            >
              <div className="flex h-8 items-center justify-center gap-2 rounded-rounded-xs px-3 py-2.5 min-w-[100px]">
                <FeatherZap className="font-['Inter_Tight'] text-[12px] font-[400] leading-[12px] text-neutral-900" />
                <span className="text-button-xs font-button-xs text-neutral-900">
                  Actions
                </span>
              </div>
              <div className="flex h-8 items-center justify-center gap-2 rounded-rounded-xs border-2 border-solid border-alpha-white-48 bg-alpha-slate-8 px-3 py-2.5 min-w-[100px]">
                <FeatherSparkles className="font-['Inter_Tight'] text-[12px] font-[400] leading-[12px] text-neutral-900" />
                <span className="text-button-xs font-button-xs text-neutral-900">
                  Ask Max
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      {footText ? (
        <div
          className={SubframeUtils.twClassNames(
            "flex w-full items-center justify-center",
            { hidden: minimized || type === "action" }
          )}
        >
          {footText}
        </div>
      ) : null}
    </div>
  );
});

export const CommandInput = Object.assign(CommandInputRoot, {
  AiBar,
  Input,
  InputIconButton,
  FileTag,
  CommandRow,
  CommandTag,
});
