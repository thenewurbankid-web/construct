"use client";

import React from "react";
import { Avatar } from "@/ui-v2/components/Avatar";
import { Badge } from "@/ui-v2/components/Badge";
import { Button } from "@/ui-v2/components/Button";
import { IconButton } from "@/ui-v2/components/IconButton";
import { InlineConversation } from "@/ui-v2/components/InlineConversation";
import { MaxStates } from "@/ui-v2/components/MaxStates";
import { MetricCard } from "@/ui-v2/components/MetricCard";
import { PageLayoutTopBar } from "@/ui-v2/components/PageLayoutTopBar";
import { SideNav } from "@/ui-v2/components/SideNav";
import { Suggestion } from "@/ui-v2/components/Suggestion";
import { Table } from "@/ui-v2/components/Table";
import { TopbarWithRightNav } from "@/ui-v2/components/TopbarWithRightNav";
import { FeatherActivity } from "@subframe/core";
import { FeatherArrowDownLeft } from "@subframe/core";
import { FeatherArrowRightCircle } from "@subframe/core";
import { FeatherArrowUpRight } from "@subframe/core";
import { FeatherCheckSquare } from "@subframe/core";
import { FeatherChevronDown } from "@subframe/core";
import { FeatherChevronRight } from "@subframe/core";
import { FeatherFileText } from "@subframe/core";
import { FeatherGauge } from "@subframe/core";
import { FeatherHome } from "@subframe/core";
import { FeatherLayers } from "@subframe/core";
import { FeatherMessageCircle } from "@subframe/core";
import { FeatherMinus } from "@subframe/core";
import { FeatherPencilLine } from "@subframe/core";
import { FeatherSearch } from "@subframe/core";
import { FeatherShieldCheck } from "@subframe/core";
import { FeatherSparkles } from "@subframe/core";

function RedesignedPortfolioHealth() {
  return (
    <div className="flex w-full flex-col items-start">
      <PageLayoutTopBar
        className="bg-bg-01"
        header={
          <TopbarWithRightNav
            className="relative z-50 border-b border-solid border-alpha-slate-8 bg-bg-01/90 backdrop-blur-md"
            leftSlot={
              <>
                <IconButton
                  size="small"
                  icon={<FeatherHome />}
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}}
                />
                <FeatherChevronRight className="text-body-2 font-body-2 text-subtext-color" />
                <Button
                  variant="white"
                  size="small"
                  icon={<FeatherGauge />}
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}}
                >
                  Health
                </Button>
                <FeatherChevronRight className="text-body-2 font-body-2 text-subtext-color" />
                <Button
                  variant="brand-subtle"
                  size="small"
                  icon={<FeatherLayers />}
                  iconRight={<FeatherChevronDown />}
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}}
                >
                  My Portfolio
                </Button>
              </>
            }
            rightSlot={
              <>
                <TopbarWithRightNav.NavItem icon={<FeatherSearch />} />
                <MaxStates className="h-10 w-10 flex-none" />
                <div className="flex h-10 items-center justify-center gap-2 rounded-rounded-sm bg-default-background px-3.5 shadow-sm">
                  <Avatar variant="brand" size="small" image="">
                    PN
                  </Avatar>
                  <span className="whitespace-nowrap text-button font-button text-neutral-700">
                    Prerna
                  </span>
                  <FeatherChevronDown className="text-body-2 font-body-2 text-default-font" />
                </div>
              </>
            }
          />
        }
        sideNav={
          <SideNav
            className="items-stretch overflow-y-auto overflow-x-hidden overscroll-y-contain sticky top-0 self-start"
            header={
              <img
                className="h-[46px] w-[132px] flex-none object-cover"
                src="https://res.cloudinary.com/subframe/image/upload/v1779088580/uploads/13599/umuo3ewiydxrlr6g2q0a.svg"
              />
            }
            mainMenu={
              <>
                <SideNav.NavSection label="Today">
                  <SideNav.NavItem icon={<FeatherHome />} collapsed={true}>
                    Home
                  </SideNav.NavItem>
                  <SideNav.NavItem
                    icon={<FeatherCheckSquare />}
                    collapsed={true}
                  >
                    Actions
                  </SideNav.NavItem>
                </SideNav.NavSection>
                <SideNav.NavSection label="Monitor">
                  <SideNav.NavItem
                    icon={<FeatherShieldCheck />}
                    collapsed={true}
                  >
                    Opportunity
                  </SideNav.NavItem>
                  <SideNav.NavItem
                    icon={<FeatherGauge />}
                    selected={true}
                    collapsed={true}
                  >
                    Health
                  </SideNav.NavItem>
                  <SideNav.NavItem icon={<FeatherActivity />} collapsed={true}>
                    Signal
                  </SideNav.NavItem>
                </SideNav.NavSection>
                <SideNav.NavSection label="Work with Max">
                  <SideNav.NavItem
                    icon={<FeatherMessageCircle />}
                    collapsed={true}
                  >
                    Conversations
                  </SideNav.NavItem>
                  <SideNav.NavItem icon={<FeatherFileText />} collapsed={true}>
                    Artifacts
                  </SideNav.NavItem>
                  <SideNav.NavItem icon={<FeatherSparkles />} collapsed={true}>
                    My Max
                  </SideNav.NavItem>
                </SideNav.NavSection>
              </>
            }
            collapsed={true}
          />
        }
      >
        <div className="flex w-full max-w-[1280px] flex-col items-start gap-10 bg-bg-01 px-10 pt-6 pb-32 self-center mx-auto mobile:gap-8 mobile:px-4 tablet:px-6">
          <section className="flex w-full flex-col items-start gap-4 py-2">
            <div className="flex w-full items-center gap-4">
              <MaxStates className="h-4 w-4 flex-none" />
              <span className="whitespace-nowrap text-caption-xs-mono font-caption-xs-mono text-accent-soft-indigo uppercase tracking-[0.2em]">
                Max · your portfolio summary
              </span>
              <div className="flex h-px min-w-[0px] items-start flex-1 bg-gradient-to-r from-alpha-brand-32 to-alpha-brand-8" />
            </div>
            <div className="w-full items-start gap-4 py-8 grid grid-cols-12 tablet:gap-6 tablet:py-6 tablet:grid tablet:grid-cols-1">
              <div className="flex flex-col items-start gap-2.5 self-stretch col-span-4 tablet:col-span-1">
                <h1 className="w-full grow shrink-0 basis-0 text-h3 font-h3 text-neutral-900">
                  Grains is carrying your portfolio. Logistics and Packaging are
                  not.
                </h1>
                <span className="whitespace-nowrap text-overline-xs-mono font-overline-xs-mono text-accent-soft-indigo uppercase">
                  31 Jul 2026
                </span>
              </div>
              <div className="flex max-w-[700px] flex-col items-start col-span-7 col-start-6 tablet:col-span-1 tablet:col-start-1">
                <span className="text-subtitle-1 font-subtitle-1 text-neutral-700">
                  Improving:
                </span>
                <p className="text-body-1 font-body-1 text-neutral-700 mb-3">
                  Grains, up on contract coverage and a renegotiated origination
                  mix, and Chemicals, where the solvent index fell two quarters
                  running.
                </p>
                <span className="text-subtitle-1 font-subtitle-1 text-neutral-700">
                  Declining:
                </span>
                <p className="text-body-1 font-body-1 text-neutral-700">
                  Logistics, where the maturity gap widened to −0.7 and three
                  high flags are open, and Packaging, where supplier
                  concentration moved the wrong way. IT &amp; Software is flat.
                  There is no single portfolio score here on purpose — averaging
                  six categories produces a number that means nothing.
                </p>
              </div>
            </div>
            <div className="flex w-full max-w-[832px] items-start">
              <InlineConversation
                state="default"
                suggestionsLabel="ASK ABOUT THIS"
                exchangeCount=""
                question=""
                carouselPosition=""
                suggestions={
                  <>
                    <Suggestion
                      label={
                        <span className="min-w-[0px] grow shrink-0 basis-0 self-stretch whitespace-nowrap text-body-2-max font-body-2-max text-accent-vivid-indigo overflow-hidden text-ellipsis">
                          Who could take 20% of this volume?
                        </span>
                      }
                    />
                    <Suggestion
                      label={
                        <span className="min-w-[0px] grow shrink-0 basis-0 self-stretch whitespace-nowrap text-body-2-max font-body-2-max text-accent-vivid-indigo overflow-hidden text-ellipsis">
                          What am I missing?
                        </span>
                      }
                    />
                    <Suggestion
                      type="custom-prompt"
                      label={
                        <span className="min-w-[0px] grow shrink-0 basis-0 self-stretch whitespace-nowrap text-body-2-max font-body-2-max text-accent-vivid-indigo overflow-hidden text-ellipsis">
                          Ask your own question
                        </span>
                      }
                      icon={<FeatherPencilLine />}
                    />
                  </>
                }
              />
            </div>
          </section>
          <section className="flex w-full flex-col items-start gap-12">
            <div className="flex w-full flex-col items-start gap-7">
              <div className="flex w-full items-center gap-4 overflow-hidden">
                <h2 className="whitespace-nowrap text-h5 font-h5 text-neutral-900">
                  Your portfolio at a glance
                </h2>
                <div className="flex h-px min-w-[0px] items-start bg-alpha-slate-12 flex-1" />
              </div>
              <div className="w-full items-start gap-4 grid grid-cols-12 tablet:grid tablet:grid-cols-1">
                <MetricCard
                  className="h-auto grow shrink-0 basis-0 self-stretch col-span-4 min-w-0 tablet:min-w-0 tablet:col-span-1"
                  errorMessage=""
                  nodataMessage=""
                  headerSlot={
                    <span className="grow shrink-0 basis-0 break-words text-caption-mono font-caption-mono text-neutral-900 uppercase">
                      Baseline spend
                    </span>
                  }
                  narrativeSlot={
                    <MetricCard.Narrative>
                      4 categories carry at least one high.
                    </MetricCard.Narrative>
                  }
                  provenanceSlot={
                    <MetricCard.Provenance
                      className="[&_span]:uppercase"
                      freshness="current"
                    >
                      Jan 2020 - Mar 2020 · As of 14 Mar, 09:00
                    </MetricCard.Provenance>
                  }
                  showProvenanceSlot={true}
                >
                  <MetricCard.Value
                    className="[&>span:last-child]:text-neutral-500"
                    size="display"
                    prefix=""
                    suffix="M"
                  >
                    $280
                  </MetricCard.Value>
                </MetricCard>
                <MetricCard
                  className="h-auto grow shrink-0 basis-0 self-stretch col-span-4 min-w-0 bg-cyan-300 tablet:min-w-0 tablet:bg-cyan-300 tablet:col-span-1"
                  errorMessage=""
                  nodataMessage=""
                  headerSlot={
                    <span className="grow shrink-0 basis-0 break-words text-caption-mono font-caption-mono text-neutral-900 uppercase">
                      Potential savings
                    </span>
                  }
                  narrativeSlot={
                    <MetricCard.Narrative>
                      Identified across 25 qualified opportunities
                    </MetricCard.Narrative>
                  }
                  showProvenanceSlot={false}
                >
                  <MetricCard.Value size="display" prefix="" suffix="M">
                    $42 - 68
                  </MetricCard.Value>
                </MetricCard>
                <MetricCard
                  className="h-auto grow shrink-0 basis-0 self-stretch col-span-4 min-w-0 tablet:min-w-0 tablet:col-span-1"
                  errorMessage=""
                  nodataMessage=""
                  headerSlot={
                    <span className="grow shrink-0 basis-0 break-words text-caption-mono font-caption-mono text-neutral-900 uppercase">
                      Categories covered
                    </span>
                  }
                  narrativeSlot={
                    <MetricCard.Narrative>
                      Risk reduction awaiting a decision. Not measured in
                      savings, so it is counted separately.
                    </MetricCard.Narrative>
                  }
                  showProvenanceSlot={false}
                >
                  <MetricCard.Value size="display" prefix="" suffix="">
                    21
                  </MetricCard.Value>
                </MetricCard>
                <MetricCard
                  className="h-auto grow shrink-0 basis-0 self-stretch col-span-4 min-h-[242px] min-w-0 tablet:min-h-[242px] tablet:min-w-0 tablet:col-span-1"
                  visualizationSlot={
                    <div className="flex w-full flex-col items-start gap-2.5 py-1">
                      <div className="flex w-full items-start gap-0.5">
                        <div className="flex h-2 min-w-[2px] items-start rounded-[2px] border border-solid border-alpha-slate-8 bg-cyan-500 grow-[7] shrink basis-0" />
                        <div className="flex h-2 min-w-[2px] items-start rounded-[2px] border border-solid border-alpha-slate-8 bg-cyan-300 grow-[13] shrink basis-0" />
                        <div className="flex h-2 min-w-[2px] items-start rounded-[2px] border border-solid border-neutral-300 bg-neutral-200 grow-[1] shrink basis-0" />
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="flex h-2 w-2 flex-none items-start rounded-full bg-cyan-500" />
                          <span className="text-body-2 font-body-2 text-neutral-600">
                            High
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="flex h-2 w-2 flex-none items-start rounded-full bg-cyan-300" />
                          <span className="text-body-2 font-body-2 text-neutral-600">
                            Medium
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="flex h-2 w-2 flex-none items-start rounded-full bg-neutral-300" />
                          <span className="text-body-2 font-body-2 text-neutral-600">
                            Low
                          </span>
                        </div>
                      </div>
                    </div>
                  }
                  errorMessage=""
                  nodataMessage=""
                  headerSlot={
                    <span className="grow shrink-0 basis-0 break-words text-caption-mono font-caption-mono text-neutral-900 uppercase">
                      Resilience initiatives
                    </span>
                  }
                  narrativeSlot={
                    <MetricCard.Narrative>
                      4 categories carry at least one high.
                    </MetricCard.Narrative>
                  }
                  showProvenanceSlot={false}
                >
                  <MetricCard.Value size="display" prefix="" suffix="">
                    21
                  </MetricCard.Value>
                </MetricCard>
                <MetricCard
                  className="h-auto grow shrink-0 basis-0 self-stretch col-span-4 min-h-[242px] min-w-0 tablet:min-h-[242px] tablet:min-w-0 tablet:col-span-1"
                  visualizationSlot={
                    <div className="flex w-full flex-col items-start gap-2.5 py-1">
                      <div className="flex w-full items-start gap-0.5">
                        <div className="flex h-2 min-w-[2px] items-start rounded-[2px] border border-solid border-alpha-slate-8 bg-cyan-500 grow-[10] shrink basis-0" />
                        <div className="flex h-2 min-w-[2px] items-start rounded-[2px] border border-solid border-alpha-slate-8 bg-cyan-300 grow-[11] shrink basis-0" />
                        <div className="flex h-2 min-w-[2px] items-start rounded-[2px] border border-solid border-neutral-300 bg-neutral-200 grow-[5] shrink basis-0" />
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="flex h-2 w-2 flex-none items-start rounded-full bg-cyan-500" />
                          <span className="text-body-2 font-body-2 text-neutral-600">
                            High
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="flex h-2 w-2 flex-none items-start rounded-full bg-cyan-300" />
                          <span className="text-body-2 font-body-2 text-neutral-600">
                            Medium
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="flex h-2 w-2 flex-none items-start rounded-full bg-neutral-300" />
                          <span className="text-body-2 font-body-2 text-neutral-600">
                            Low
                          </span>
                        </div>
                      </div>
                    </div>
                  }
                  errorMessage=""
                  nodataMessage=""
                  headerSlot={
                    <span className="grow shrink-0 basis-0 break-words text-caption-mono font-caption-mono text-neutral-900 uppercase">
                      Savings initiatives
                    </span>
                  }
                  narrativeSlot={
                    <MetricCard.Narrative>
                      Savings initiatives raised but not yet accepted by an
                      owner. Oldest has been waiting 34 days.
                    </MetricCard.Narrative>
                  }
                  showProvenanceSlot={false}
                >
                  <MetricCard.Value size="display" prefix="" suffix="">
                    26
                  </MetricCard.Value>
                </MetricCard>
                <MetricCard
                  className="h-auto grow shrink-0 basis-0 self-stretch col-span-4 min-h-[242px] min-w-0 tablet:min-h-[242px] tablet:min-w-0 tablet:col-span-1"
                  visualizationSlot={
                    <div className="flex w-full flex-col items-start gap-2.5 py-1">
                      <div className="flex w-full items-start gap-0.5">
                        <div className="flex h-2 min-w-[2px] items-start rounded-[2px] border border-solid border-alpha-slate-8 bg-cyan-500 grow-[13] shrink basis-0" />
                        <div className="flex h-2 min-w-[2px] items-start rounded-[2px] border border-solid border-neutral-300 bg-neutral-200 grow-[3] shrink basis-0" />
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="flex h-2 w-2 flex-none items-start rounded-full bg-cyan-500" />
                          <span className="text-body-2 font-body-2 text-neutral-600">
                            Accepted
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="flex h-2 w-2 flex-none items-start rounded-full bg-neutral-300" />
                          <span className="text-body-2 font-body-2 text-neutral-600">
                            Pending
                          </span>
                        </div>
                      </div>
                    </div>
                  }
                  errorMessage=""
                  nodataMessage=""
                  headerSlot={
                    <span className="grow shrink-0 basis-0 break-words text-caption-mono font-caption-mono text-neutral-900 uppercase">
                      Qualified initiatives
                    </span>
                  }
                  narrativeSlot={
                    <MetricCard.Narrative>
                      Risk reduction awaiting a decision. Not measured in
                      savings, so it is counted separately.
                    </MetricCard.Narrative>
                  }
                  showProvenanceSlot={false}
                >
                  <MetricCard.Value size="display" prefix="" suffix="">
                    16
                  </MetricCard.Value>
                </MetricCard>
              </div>
            </div>
            <div className="flex w-full max-w-[832px] items-start">
              <InlineConversation
                state="default"
                suggestionsLabel="ASK ABOUT THIS"
                exchangeCount=""
                question=""
                carouselPosition=""
                suggestions={
                  <>
                    <Suggestion
                      label={
                        <span className="min-w-[0px] grow shrink-0 basis-0 self-stretch whitespace-nowrap text-body-2-max font-body-2-max text-accent-vivid-indigo overflow-hidden text-ellipsis">
                          Who could take 20% of this volume?
                        </span>
                      }
                    />
                    <Suggestion
                      label={
                        <span className="min-w-[0px] grow shrink-0 basis-0 self-stretch whitespace-nowrap text-body-2-max font-body-2-max text-accent-vivid-indigo overflow-hidden text-ellipsis">
                          What am I missing?
                        </span>
                      }
                    />
                    <Suggestion
                      type="custom-prompt"
                      label={
                        <span className="min-w-[0px] grow shrink-0 basis-0 self-stretch whitespace-nowrap text-body-2-max font-body-2-max text-accent-vivid-indigo overflow-hidden text-ellipsis">
                          Ask your own question
                        </span>
                      }
                      icon={<FeatherPencilLine />}
                    />
                  </>
                }
              />
            </div>
          </section>
          <section className="flex w-full flex-col items-start gap-7">
            <div className="flex w-full flex-col items-start gap-3">
              <div className="flex w-full items-center gap-4 overflow-hidden">
                <h2 className="whitespace-nowrap text-h5 font-h5 text-neutral-900">
                  Category overview
                </h2>
                <div className="flex h-px min-w-[0px] items-start bg-alpha-slate-12 flex-1" />
              </div>
              <p className="max-w-[760px] text-body-2 font-body-2 text-neutral-600">
                Order based on top spend categories (Top 10) within that ordered
                by the ones needing max attention).
              </p>
            </div>
            <div className="flex w-full flex-col items-start overflow-hidden rounded-[14px] border border-solid border-alpha-slate-8 bg-default-background">
              <Table
                header={
                  <Table.HeaderRow>
                    <Table.HeaderCell className="h-[50px] w-[72px] flex-none pl-6">
                      #
                    </Table.HeaderCell>
                    <Table.HeaderCell className="h-[50px] grow shrink-0 basis-0">
                      Category
                    </Table.HeaderCell>
                    <Table.HeaderCell
                      className="h-[50px] w-32 flex-none"
                      variant="right-aligned"
                    >
                      Spend
                    </Table.HeaderCell>
                    <Table.HeaderCell className="h-[50px] w-[104px] flex-none [&>div]:justify-center">
                      Maturity
                    </Table.HeaderCell>
                    <Table.HeaderCell className="h-[50px] w-[180px] flex-none">
                      Potential savings
                    </Table.HeaderCell>
                    <Table.HeaderCell className="h-[50px] w-24 flex-none [&>div]:justify-center [&_span]:whitespace-normal [&_span]:text-center">
                      Composite risk score
                    </Table.HeaderCell>
                    <Table.HeaderCell className="h-[50px] w-28 flex-none [&>div]:justify-center [&_span]:whitespace-normal [&_span]:text-center">
                      Spend change
                    </Table.HeaderCell>
                    <Table.HeaderCell className="h-[50px] w-16 flex-none pr-6" />
                  </Table.HeaderRow>
                }
              >
                <Table.Row
                  className="bg-orange-50 hover:bg-orange-50"
                  clickable={true}
                >
                  <Table.Cell className="h-24 w-[72px] flex-none py-[18px] pl-6">
                    <span className="text-caption-mono font-caption-mono text-neutral-500">
                      01
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 grow shrink-0 basis-0 py-[18px]">
                    <div className="flex min-w-[0px] flex-col items-start gap-[7px]">
                      <div className="flex items-center gap-2">
                        <span className="text-subtitle-1 font-subtitle-1 text-neutral-900">
                          Logistics
                        </span>
                        <div className="flex items-start rounded-[2px] border border-solid border-neutral-200 px-1">
                          <span className="text-caption-xs-mono font-caption-xs-mono text-neutral-400">
                            L2
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="neutral" size="xs">
                          37% of total spend
                        </Badge>
                        <Badge variant="neutral" size="xs">
                          5 qualified opportunities
                        </Badge>
                        <Badge variant="neutral" size="xs">
                          5 accepted
                        </Badge>
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell
                    className="h-24 w-32 flex-none py-[18px]"
                    variant="right-aligned"
                  >
                    <span className="text-subtitle-2-max font-subtitle-2-max text-neutral-900">
                      $78.4M
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-[104px] flex-none py-[18px]">
                    <div className="flex grow shrink-0 basis-0 flex-col items-center gap-[3px]">
                      <span className="text-subtitle-2-max font-subtitle-2-max text-error-700">
                        2.0
                      </span>
                      <span className="text-caption-xs font-caption-xs text-neutral-400">
                        peer 2.7
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-[180px] flex-none py-[18px]">
                    <div className="flex grow shrink-0 basis-0 flex-col items-start gap-[7px]">
                      <span className="text-subtitle-2-max font-subtitle-2-max text-neutral-900">
                        $4.7M - $5.6M
                      </span>
                      <div className="flex h-2 w-full flex-none items-start overflow-hidden rounded-[2px] bg-[#eef0f3]">
                        <div className="flex items-start self-stretch bg-[#9fe3ef] w-[66.2%]" />
                        <div className="flex items-start self-stretch bg-cyan-400 w-[12.7%]" />
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-24 flex-none justify-center py-[18px]">
                    <span className="grow shrink-0 basis-0 text-subtitle-2-max font-subtitle-2-max text-neutral-900 text-center">
                      72
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-28 flex-none justify-center py-[18px]">
                    <div className="flex items-center gap-1 text-error-700">
                      <FeatherArrowUpRight className="text-body-1 font-body-1 text-error-700" />
                      <span className="text-caption-mono font-caption-mono text-error-700">
                        +$5.1M
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell
                    className="h-24 w-16 flex-none py-[18px] pr-6"
                    variant="right-aligned"
                  >
                    <FeatherArrowRightCircle className="text-h5 font-h5 text-neutral-500" />
                  </Table.Cell>
                </Table.Row>
                <Table.Row
                  className="bg-orange-50 hover:bg-orange-50"
                  clickable={true}
                >
                  <Table.Cell className="h-24 w-[72px] flex-none py-[18px] pl-6">
                    <span className="text-caption-mono font-caption-mono text-neutral-500">
                      02
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 grow shrink-0 basis-0 py-[18px]">
                    <div className="flex min-w-[0px] flex-col items-start gap-[7px]">
                      <div className="flex items-center gap-2">
                        <span className="text-subtitle-1 font-subtitle-1 text-neutral-900">
                          Packaging
                        </span>
                        <div className="flex items-start rounded-[2px] border border-solid border-neutral-200 px-1">
                          <span className="text-caption-xs-mono font-caption-xs-mono text-neutral-400">
                            L2
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="neutral" size="xs">
                          22.4% of total spend
                        </Badge>
                        <Badge variant="neutral" size="xs">
                          3 qualified opportunities
                        </Badge>
                        <Badge variant="neutral" size="xs">
                          2 accepted
                        </Badge>
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell
                    className="h-24 w-32 flex-none py-[18px]"
                    variant="right-aligned"
                  >
                    <span className="text-subtitle-2-max font-subtitle-2-max text-neutral-900">
                      $62.8M
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-[104px] flex-none py-[18px]">
                    <div className="flex grow shrink-0 basis-0 flex-col items-center gap-[3px]">
                      <span className="text-subtitle-2-max font-subtitle-2-max text-error-700">
                        1.8
                      </span>
                      <span className="text-caption-xs font-caption-xs text-neutral-400">
                        peer 2.4
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-[180px] flex-none py-[18px]">
                    <div className="flex grow shrink-0 basis-0 flex-col items-start gap-[7px]">
                      <span className="text-subtitle-2-max font-subtitle-2-max text-neutral-900">
                        $5.3M - $7.1M
                      </span>
                      <div className="flex h-2 w-full flex-none items-start overflow-hidden rounded-[2px] bg-[#eef0f3]">
                        <div className="flex items-start self-stretch bg-[#9fe3ef] w-[74.6%]" />
                        <div className="flex items-start self-stretch bg-cyan-400 w-[25.4%]" />
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-24 flex-none justify-center py-[18px]">
                    <span className="grow shrink-0 basis-0 text-subtitle-2-max font-subtitle-2-max text-neutral-900 text-center">
                      69
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-28 flex-none justify-center py-[18px]">
                    <div className="flex items-center gap-1 text-success-700">
                      <FeatherArrowDownLeft className="text-body-1 font-body-1 text-success-700" />
                      <span className="text-caption-mono font-caption-mono text-success-700">
                        -$3.2M
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell
                    className="h-24 w-16 flex-none py-[18px] pr-6"
                    variant="right-aligned"
                  >
                    <FeatherArrowRightCircle className="text-h5 font-h5 text-neutral-500" />
                  </Table.Cell>
                </Table.Row>
                <Table.Row clickable={true}>
                  <Table.Cell className="h-24 w-[72px] flex-none py-[18px] pl-6">
                    <span className="text-caption-mono font-caption-mono text-neutral-500">
                      03
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 grow shrink-0 basis-0 py-[18px]">
                    <div className="flex min-w-[0px] flex-col items-start gap-[7px]">
                      <div className="flex items-center gap-2">
                        <span className="text-subtitle-1 font-subtitle-1 text-neutral-900">
                          IT Services
                        </span>
                        <div className="flex items-start rounded-[2px] border border-solid border-neutral-200 px-1">
                          <span className="text-caption-xs-mono font-caption-xs-mono text-neutral-400">
                            L2
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="neutral" size="xs">
                          21.4% of total spend
                        </Badge>
                        <Badge variant="neutral" size="xs">
                          3 qualified opportunities
                        </Badge>
                        <Badge variant="neutral" size="xs">
                          2 accepted
                        </Badge>
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell
                    className="h-24 w-32 flex-none py-[18px]"
                    variant="right-aligned"
                  >
                    <span className="text-subtitle-2-max font-subtitle-2-max text-neutral-900">
                      $45.2M
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-[104px] flex-none py-[18px]">
                    <div className="flex grow shrink-0 basis-0 flex-col items-center gap-[3px]">
                      <span className="text-subtitle-2-max font-subtitle-2-max text-error-700">
                        2.1
                      </span>
                      <span className="text-caption-xs font-caption-xs text-neutral-400">
                        peer 2.6
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-[180px] flex-none py-[18px]">
                    <div className="flex grow shrink-0 basis-0 flex-col items-start gap-[7px]">
                      <span className="text-subtitle-2-max font-subtitle-2-max text-neutral-900">
                        $3.5M - $4.2M
                      </span>
                      <div className="flex h-2 w-full flex-none items-start overflow-hidden rounded-[2px] bg-[#eef0f3]">
                        <div className="flex items-start self-stretch bg-[#9fe3ef] w-[49.3%]" />
                        <div className="flex items-start self-stretch bg-cyan-400 w-[9.9%]" />
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-24 flex-none justify-center py-[18px]">
                    <span className="grow shrink-0 basis-0 text-subtitle-2-max font-subtitle-2-max text-neutral-900 text-center">
                      67
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-28 flex-none justify-center py-[18px]">
                    <div className="flex items-center gap-1 text-error-700">
                      <FeatherArrowUpRight className="text-body-1 font-body-1 text-error-700" />
                      <span className="text-caption-mono font-caption-mono text-error-700">
                        +$1.2M
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell
                    className="h-24 w-16 flex-none py-[18px] pr-6"
                    variant="right-aligned"
                  >
                    <FeatherArrowRightCircle className="text-h5 font-h5 text-neutral-500" />
                  </Table.Cell>
                </Table.Row>
                <Table.Row clickable={true}>
                  <Table.Cell className="h-24 w-[72px] flex-none py-[18px] pl-6">
                    <span className="text-caption-mono font-caption-mono text-neutral-500">
                      04
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 grow shrink-0 basis-0 py-[18px]">
                    <div className="flex min-w-[0px] flex-col items-start gap-[7px]">
                      <div className="flex items-center gap-2">
                        <span className="text-subtitle-1 font-subtitle-1 text-neutral-900">
                          Professional Services
                        </span>
                        <div className="flex items-start rounded-[2px] border border-solid border-neutral-200 px-1">
                          <span className="text-caption-xs-mono font-caption-xs-mono text-neutral-400">
                            L2
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="neutral" size="xs">
                          22.4% of total spend
                        </Badge>
                        <Badge variant="neutral" size="xs">
                          3 qualified opportunities
                        </Badge>
                        <Badge variant="neutral" size="xs">
                          2 accepted
                        </Badge>
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell
                    className="h-24 w-32 flex-none py-[18px]"
                    variant="right-aligned"
                  >
                    <span className="text-subtitle-2-max font-subtitle-2-max text-neutral-900">
                      $27.3M
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-[104px] flex-none py-[18px]">
                    <div className="flex grow shrink-0 basis-0 flex-col items-center gap-[3px]">
                      <span className="text-subtitle-2-max font-subtitle-2-max text-error-700">
                        2.3
                      </span>
                      <span className="text-caption-xs font-caption-xs text-neutral-400">
                        peer 2.5
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-[180px] flex-none py-[18px]">
                    <div className="flex grow shrink-0 basis-0 flex-col items-start gap-[7px]">
                      <span className="text-subtitle-2-max font-subtitle-2-max text-neutral-900">
                        $1.8M - $2.9M
                      </span>
                      <div className="flex h-2 w-full flex-none items-start overflow-hidden rounded-[2px] bg-[#eef0f3]">
                        <div className="flex items-start self-stretch bg-[#9fe3ef] w-[25.4%]" />
                        <div className="flex items-start self-stretch bg-cyan-400 w-[15.5%]" />
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-24 flex-none justify-center py-[18px]">
                    <span className="grow shrink-0 basis-0 text-subtitle-2-max font-subtitle-2-max text-neutral-900 text-center">
                      59
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-28 flex-none justify-center py-[18px]">
                    <div className="flex items-center gap-1 text-neutral-500">
                      <FeatherMinus className="text-body-1 font-body-1 text-neutral-500" />
                      <span className="text-caption-mono font-caption-mono text-neutral-500">
                        $0.0
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell
                    className="h-24 w-16 flex-none py-[18px] pr-6"
                    variant="right-aligned"
                  >
                    <FeatherArrowRightCircle className="text-h5 font-h5 text-neutral-500" />
                  </Table.Cell>
                </Table.Row>
                <Table.Row clickable={true}>
                  <Table.Cell className="h-24 w-[72px] flex-none py-[18px] pl-6">
                    <span className="text-caption-mono font-caption-mono text-neutral-500">
                      05
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 grow shrink-0 basis-0 py-[18px]">
                    <div className="flex min-w-[0px] flex-col items-start gap-[7px]">
                      <div className="flex items-center gap-2">
                        <span className="text-subtitle-1 font-subtitle-1 text-neutral-900">
                          MRO
                        </span>
                        <div className="flex items-start rounded-[2px] border border-solid border-neutral-200 px-1">
                          <span className="text-caption-xs-mono font-caption-xs-mono text-neutral-400">
                            L2
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="neutral" size="xs">
                          22.4% of total spend
                        </Badge>
                        <Badge variant="neutral" size="xs">
                          3 qualified opportunities
                        </Badge>
                        <Badge variant="neutral" size="xs">
                          2 accepted
                        </Badge>
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell
                    className="h-24 w-32 flex-none py-[18px]"
                    variant="right-aligned"
                  >
                    <span className="text-subtitle-2-max font-subtitle-2-max text-neutral-900">
                      $14.9M
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-[104px] flex-none py-[18px]">
                    <div className="flex grow shrink-0 basis-0 flex-col items-center gap-[3px]">
                      <span className="text-subtitle-2-max font-subtitle-2-max text-error-700">
                        2.2
                      </span>
                      <span className="text-caption-xs font-caption-xs text-neutral-400">
                        peer 2.3
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-[180px] flex-none py-[18px]">
                    <div className="flex grow shrink-0 basis-0 flex-col items-start gap-[7px]">
                      <span className="text-subtitle-2-max font-subtitle-2-max text-neutral-900">
                        $0.8M - $1.4M
                      </span>
                      <div className="flex h-2 w-full flex-none items-start overflow-hidden rounded-[2px] bg-[#eef0f3]">
                        <div className="flex items-start self-stretch bg-[#9fe3ef] w-[11.3%]" />
                        <div className="flex items-start self-stretch bg-cyan-400 w-[8.5%]" />
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-24 flex-none justify-center py-[18px]">
                    <span className="grow shrink-0 basis-0 text-subtitle-2-max font-subtitle-2-max text-neutral-900 text-center">
                      84
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-28 flex-none justify-center py-[18px]">
                    <div className="flex items-center gap-1 text-error-700">
                      <FeatherArrowUpRight className="text-body-1 font-body-1 text-error-700" />
                      <span className="text-caption-mono font-caption-mono text-error-700">
                        +$5.1M
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell
                    className="h-24 w-16 flex-none py-[18px] pr-6"
                    variant="right-aligned"
                  >
                    <FeatherArrowRightCircle className="text-h5 font-h5 text-neutral-500" />
                  </Table.Cell>
                </Table.Row>
                <Table.Row clickable={true}>
                  <Table.Cell className="h-24 w-[72px] flex-none py-[18px] pl-6">
                    <span className="text-caption-mono font-caption-mono text-neutral-500">
                      06
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 grow shrink-0 basis-0 py-[18px]">
                    <div className="flex min-w-[0px] flex-col items-start gap-[7px]">
                      <div className="flex items-center gap-2">
                        <span className="text-subtitle-1 font-subtitle-1 text-neutral-900">
                          Grains &amp; Cereals
                        </span>
                        <div className="flex items-start rounded-[2px] border border-solid border-neutral-200 px-1">
                          <span className="text-caption-xs-mono font-caption-xs-mono text-neutral-400">
                            L2
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="neutral" size="xs">
                          22.4% of total spend
                        </Badge>
                        <Badge variant="neutral" size="xs">
                          3 qualified opportunities
                        </Badge>
                        <Badge variant="neutral" size="xs">
                          2 accepted
                        </Badge>
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell
                    className="h-24 w-32 flex-none py-[18px]"
                    variant="right-aligned"
                  >
                    <span className="text-subtitle-2-max font-subtitle-2-max text-neutral-900">
                      $11.6M
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-[104px] flex-none py-[18px]">
                    <div className="flex grow shrink-0 basis-0 flex-col items-center gap-[3px]">
                      <span className="text-subtitle-2-max font-subtitle-2-max text-success-700">
                        2.9
                      </span>
                      <span className="text-caption-xs font-caption-xs text-neutral-400">
                        peer 2.6
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-[180px] flex-none py-[18px]">
                    <div className="flex grow shrink-0 basis-0 flex-col items-start gap-[7px]">
                      <span className="text-subtitle-2-max font-subtitle-2-max text-neutral-900">
                        $3.2M
                      </span>
                      <div className="flex h-2 w-full flex-none items-start overflow-hidden rounded-[2px] bg-[#eef0f3]">
                        <div className="flex items-start self-stretch bg-[#9fe3ef] w-[45.1%]" />
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-24 flex-none justify-center py-[18px]">
                    <span className="grow shrink-0 basis-0 text-subtitle-2-max font-subtitle-2-max text-neutral-900 text-center">
                      72
                    </span>
                  </Table.Cell>
                  <Table.Cell className="h-24 w-28 flex-none justify-center py-[18px]">
                    <div className="flex items-center gap-1 text-success-700">
                      <FeatherArrowDownLeft className="text-body-1 font-body-1 text-success-700" />
                      <span className="text-caption-mono font-caption-mono text-success-700">
                        -$5.1M
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell
                    className="h-24 w-16 flex-none py-[18px] pr-6"
                    variant="right-aligned"
                  >
                    <FeatherArrowRightCircle className="text-h5 font-h5 text-neutral-500" />
                  </Table.Cell>
                </Table.Row>
              </Table>
              <div className="flex w-full flex-wrap items-center border-t border-solid border-neutral-border px-6 py-4 gap-x-6 gap-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-[9px] w-[9px] flex-none items-start rounded-full bg-cyan-400" />
                  <span className="text-caption font-caption text-neutral-600">
                    Higher end of potential savings
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex h-[9px] w-[9px] flex-none items-start rounded-full bg-[#9fe3ef]" />
                  <span className="text-caption font-caption text-neutral-600">
                    Lower end of potential savings
                  </span>
                </div>
              </div>
            </div>
            <div className="flex w-full max-w-[832px] items-start">
              <InlineConversation
                state="default"
                suggestionsLabel="ASK ABOUT THIS"
                exchangeCount=""
                question=""
                carouselPosition=""
                suggestions={
                  <>
                    <Suggestion
                      label={
                        <span className="min-w-[0px] grow shrink-0 basis-0 self-stretch whitespace-nowrap text-body-2-max font-body-2-max text-accent-vivid-indigo overflow-hidden text-ellipsis">
                          Who could take 20% of this volume?
                        </span>
                      }
                    />
                    <Suggestion
                      label={
                        <span className="min-w-[0px] grow shrink-0 basis-0 self-stretch whitespace-nowrap text-body-2-max font-body-2-max text-accent-vivid-indigo overflow-hidden text-ellipsis">
                          What am I missing?
                        </span>
                      }
                    />
                    <Suggestion
                      type="custom-prompt"
                      label={
                        <span className="min-w-[0px] grow shrink-0 basis-0 self-stretch whitespace-nowrap text-body-2-max font-body-2-max text-accent-vivid-indigo overflow-hidden text-ellipsis">
                          Ask your own question
                        </span>
                      }
                      icon={<FeatherPencilLine />}
                    />
                  </>
                }
              />
            </div>
          </section>
        </div>
      </PageLayoutTopBar>
    </div>
  );
}

export default RedesignedPortfolioHealth;
