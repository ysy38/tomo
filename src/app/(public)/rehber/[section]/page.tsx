import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { brand, siteUrl } from "@/brand";
import { GuideDeep } from "@/components/guide-deep";
import { GuideSectionNav } from "@/components/guide-section-nav";
import { JsonLd } from "@/components/JsonLd";
import { TopicLinks } from "@/components/topic-links";
import { articleJsonLd, organizationJsonLd } from "@/content/editorial";
import { deepGuideFor } from "@/content/guide-labs";
import { rehberBySection } from "@/content/rehber";
import { ydsBlueprint } from "@/modules/exam/blueprint";

type Props = { params: Promise<{ section: string }> };

export function generateStaticParams() {
  return ydsBlueprint.bands.map((band) => ({ section: band.section }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section: rawSection } = await params;
  const section = rawSection === "grammer" ? "grammar" : rawSection;
  const band = ydsBlueprint.bands.find((item) => item.section === section);
  const note = rehberBySection(section);
  const deep = deepGuideFor(section);
  if (!band || !note) return { title: "Rehber" };
  if (deep) {
    return {
      title: { absolute: deep.seoTitle },
      description: deep.seoDescription,
      alternates: { canonical: `/rehber/${section}` },
      openGraph: {
        title: deep.seoTitle,
        description: deep.seoDescription,
        type: "article",
        url: `${siteUrl}/rehber/${section}`,
        siteName: brand.name,
      },
      twitter: {
        card: "summary_large_image",
        title: deep.seoTitle,
        description: deep.seoDescription,
      },
    };
  }
  return {
    title: `${band.title} nasıl çözülür`,
    description: note.measures,
    alternates: { canonical: `/rehber/${section}` },
  };
}

export default async function GuideSectionPage({ params }: Props) {
  const { section } = await params;
  const band = ydsBlueprint.bands.find((item) => item.section === section);
  const note = rehberBySection(section);
  if (!band || !note) notFound();
  const deep = deepGuideFor(section);
  const path = `/rehber/${section}`;

  const jsonLd = deep
    ? {
        "@context": "https://schema.org",
        "@graph": [
          organizationJsonLd(),
          {
            "@type": "BreadcrumbList",
            "@id": `${siteUrl}${path}#breadcrumb`,
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: siteUrl },
              { "@type": "ListItem", position: 2, name: "Rehber", item: `${siteUrl}/rehber` },
              {
                "@type": "ListItem",
                position: 3,
                name: deep.breadcrumbTitle ?? band.title,
                item: `${siteUrl}${path}`,
              },
            ],
          },
          ...(deep.course
            ? [
                {
                  "@type": "Course",
                  "@id": `${siteUrl}${path}#course`,
                  name: deep.course.name,
                  description: deep.course.description,
                  url: `${siteUrl}${path}`,
                  inLanguage: "tr-TR",
                  educationalLevel: deep.course.educationalLevel ?? "B2-C1 (Akademik İngilizce)",
                  provider: { "@id": `${siteUrl}/#organization` },
                  teaches: deep.course.teaches,
                  hasCourseInstance: {
                    "@type": "CourseInstance",
                    courseMode: "online",
                    courseWorkload: deep.course.courseWorkload,
                  },
                },
              ]
            : []),
          articleJsonLd({ path, title: deep.h1, description: deep.seoDescription }),
          {
            "@type": "HowTo",
            name: deep.nextTitle,
            description: deep.approach,
            step: deep.nextSteps.map((text, index) => ({
              "@type": "HowToStep",
              position: index + 1,
              name: `Adım ${index + 1}`,
              text,
            })),
          },
          {
            "@type": "FAQPage",
            "@id": `${siteUrl}${path}#faq`,
            mainEntity: (
              deep.faqs?.length
                ? deep.faqs
                : [
                    { question: deep.h1, answer: `${deep.lead} ${deep.approach}` },
                    {
                      question: deep.layersTitle,
                      answer: `${deep.layers.map((layer) => `${layer.title}: ${layer.body}`).join(" ")} ${deep.layersNote}`,
                    },
                    {
                      question: "Yanlış seçenekler nasıl analiz edilir?",
                      answer:
                        "Doğru cevabı ezberlemek yeterli değildir. Her yanlış seçeneğin yapısal veya anlamsal olarak neden elendiğini ayrı ayrı gerekçelendirmek gerekir.",
                    },
                  ]
            ).map((item) => ({
              "@type": "Question",
              name: item.question,
              acceptedAnswer: { "@type": "Answer", text: item.answer },
            })),
          },
        ],
      }
    : null;

  return (
    <article className="landing mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-5 sm:py-16 lg:grid-cols-[minmax(0,1fr)_min(100%,280px)] lg:gap-10">
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-[0.18em] text-gold">
          <Link href="/rehber" className="hover:text-ink">
            Rehber
          </Link>
          {" · "}
          {band.to - band.from + 1} soru · {band.title}
        </p>
        {deep ? (
          <GuideDeep guide={deep} path={path} />
        ) : (
          <>
            <GuideSectionNav section={section} className="mt-4" />
            <h1 className="display mt-6">{band.title}</h1>
            <p className="mt-4 max-w-xl leading-8 text-muted">{note.measures}</p>
            <h2 className="mt-10 text-3xl">Nasıl çözülür?</h2>
            <ol className="mt-4 space-y-3">
              {note.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm leading-6">
                  <span className="font-serif text-gold">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <h2 className="mt-10 text-3xl">Sık yapılan hatalar</h2>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-muted">
              {note.misses.map((miss) => (
                <li key={miss}>{miss}</li>
              ))}
            </ul>
            <GuideSectionNav section={section} className="mt-10" />
          </>
        )}
        <TopicLinks className="mt-14" />
      </div>

      <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
        {deep ? (
          <nav aria-label="Sayfa içi" className="rounded-[24px] border border-line bg-card p-5 sm:rounded-[28px]">
            <p className="text-xs uppercase tracking-[0.16em] text-gold">Bu sayfada</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <a href="#ornek-soru" className="font-medium text-ink hover:text-pine">
                  Örnek soruyu incele
                </a>
              </li>
              <li>
                <a href="#lab" className="font-medium text-ink hover:text-pine">
                  Örnek soru çöz
                </a>
              </li>
              <li>
                <a href="#yontem" className="text-muted hover:text-pine">
                  Çözüm adımları
                </a>
              </li>
              <li>
                <a href="#kaynaklar" className="text-muted hover:text-pine">
                  Kaynaklar
                </a>
              </li>
            </ul>
          </nav>
        ) : null}
        <div className="rounded-[24px] border border-line bg-card p-5 sm:rounded-[28px] sm:p-6">
          <p className="text-xs uppercase tracking-[0.16em] text-gold">İpucu</p>
          <p className="mt-3 text-sm leading-7 sm:text-base">{note.tip}</p>
        </div>
        <div className="rounded-[24px] border border-line bg-card p-5 sm:rounded-[28px] sm:p-6">
          <p className="text-xs uppercase tracking-[0.16em] text-gold">Senin sonuçların</p>
          <p className="mt-3 text-sm leading-6 text-muted">
            Bu bölümden kaç puan kaybettiğini seviye testi gösterir. Sonuçların uygulamada, hesabında durur.
          </p>
          <Link href="/teshis" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-pine px-4 py-2 text-sm font-semibold text-pine-ink">
            Seviye testine başla
          </Link>
        </div>
        {deep ? (
          <div className="rounded-[24px] border border-pine/25 bg-soft p-5 sm:rounded-[28px]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pine">outklas. standardı</p>
            <p className="mt-2 text-sm leading-6 text-ink">
              Yapısal kanıt → anlam kontrolü → çeldirici ayıklaması. Kuralı ezberlemek değil; soruyu çözmek ve gerekçeyi görmek.
            </p>
          </div>
        ) : null}
      </aside>
    </article>
  );
}

