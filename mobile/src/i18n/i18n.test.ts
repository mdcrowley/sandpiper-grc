// The app's translations (E41-07): every employee-facing screen's texts are translated into every
// language of shared/i18n.ts, and the screens show the person's language, falling back to English.
import { ENGLISH, getLanguage, LANGUAGES, localized, missingTranslations, setLanguage, TRANSLATIONS } from './index';

jest.mock('../api/client', () => require('../tags/tests/mocks').clientMock());
jest.mock('../auth/session', () => require('../tags/tests/mocks').sessionMock());
jest.mock('expo-router', () => require('../tags/tests/mocks').routerMock());
jest.mock('react-native-vision-camera', () => require('../tags/tests/mocks').visionCameraMock());
jest.mock('../camera/TagCamera', () => require('../tags/tests/mocks').tagCameraMock());
jest.mock('../camera/still', () => require('../tags/tests/mocks').stillMock());
jest.mock('expo-image-picker', () => require('../tags/tests/mocks').pickerMock());
jest.mock('../offline', () => ({ offlinePackage: () => ({ current: async () => null }), useOfflinePackage: () => null, outbox: () => ({}) }));
jest.mock('../camera/reportQueue', () => ({ saveReport: jest.fn(), useReports: jest.fn(() => []), migrateLegacyQueue: jest.fn() }));

// The screens whose texts are translated register them when they load.
import '../text/tabs';
import '../text/common';
import '../text/account';
import '../records/screens/WorkScreen';
import '../records/screens/AcknowledgmentScreen';
import '../tags/screens/TagScreen';
import '../tags/screens/TagCardScreen';
import '../camera/report/ReportHomeScreen';
import '../camera/report/ReportFormScreen';
import '../camera/report/build';
import '../camera/reports';

afterEach(() => setLanguage('en'));

describe('translations', () => {
  it('knows every translated screen', () => {
    expect(Object.keys(ENGLISH).sort()).toEqual(
      ['account', 'acknowledgment', 'common', 'reportChoices', 'reportForm', 'reportHome', 'reports', 'tabs', 'tag', 'tagCard', 'work'],
    );
  });

  for (const lang of LANGUAGES.filter((l) => l.code !== 'en')) {
    it(`has every text in ${lang.english}`, () => {
      expect(TRANSLATIONS[lang.code]).toBeDefined();
      expect(missingTranslations(lang.code)).toEqual({ missing: [], wrongKind: [], extra: [] });
    });
  }

  it('gives the texts in the language chosen, and English for what is not translated', () => {
    const T = localized('i18n-test', { hello: 'Hello', name: (n: string) => `Hi ${n}`, group: { a: 'A', b: 'B' } });
    TRANSLATIONS.es['i18n-test'] = { hello: 'Hola', name: (n: string) => `Hola ${n}`, group: { a: 'Á' } };
    expect(T.hello).toBe('Hello');
    setLanguage('es-MX');
    expect(getLanguage()).toBe('es');
    expect(T.hello).toBe('Hola');
    expect(T.name('Ana')).toBe('Hola Ana');
    expect(T.group.a).toBe('Á');
    expect(T.group.b).toBe('B');
    setLanguage('fr');
    expect(T.hello).toBe('Hello');
    delete TRANSLATIONS.es['i18n-test'];
    delete ENGLISH['i18n-test'];
  });
});
