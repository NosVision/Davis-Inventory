import { getTranslations } from 'next-intl/server';

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 dark:bg-gray-950">
      <div className="w-full max-w-md">
        {/* โลโก้ */}
        <div className="mb-8 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-192.png"
            alt="DavisManage"
            className="h-20 w-20 rounded-2xl object-contain shadow-sm"
          />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            DavisManage
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('meta.subtitle')}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          {children}
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-500">
          &copy; {new Date().getFullYear()} DavisManage. {t('common.allRightsReserved')}.
        </p>
      </div>
    </div>
  );
}
