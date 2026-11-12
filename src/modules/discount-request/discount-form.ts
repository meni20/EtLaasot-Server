import { BadRequestException } from '@nestjs/common';

type Answers = Record<string, string>;
type Condition = { key: string; values: string[] };
type Field = {
  key: string;
  label: string;
  kind: 'text' | 'id' | 'phone' | 'money' | 'textarea' | 'select';
  options?: Record<string, string>;
  when?: Condition;
  optional?: boolean;
};
type Section = { title: string; fields: Field[]; any?: Condition[] };
const when = (key: string, ...values: string[]): Condition => ({ key, values });
const yesNo = { yes: 'כן', no: 'לא' };
const choice = (
  key: string,
  label: string,
  options: Record<string, string> = yesNo,
): Field => ({ key, label, kind: 'select', options });
const field = (
  key: string,
  label: string,
  kind: Field['kind'] = 'text',
): Field => ({ key, label, kind });
const conditional = (fields: Field[], condition: Condition) =>
  fields.map((item) => ({ ...item, when: condition }));
const trainee = (prefix: string) => [
  field(prefix + 'Name', 'שם החניך'),
  field(prefix + 'School', 'שם ביה״ס'),
  field(prefix + 'Class', 'כיתה'),
  field(prefix + 'Id', 'תעודת זהות', 'id'),
  field(prefix + 'Branch', 'סניף'),
];
const parents = [
  { key: 'father', title: 'האב' },
  { key: 'mother', title: 'האם' },
];
const employment = {
  working: 'עובד/ת',
  unemployed: 'לא עובד/ת',
  na: 'לא רלוונטי',
};
const income = (key: string, label: string) => [
  field(key + 'Source', label),
  field(key + 'Net', 'סכום חודשי נטו (₪)', 'money'),
  field(key + 'Gross', 'סכום חודשי ברוטו (₪)', 'money'),
];

export const discountSections: Section[] = [
  {
    title: 'פרטי החניך',
    fields: [...trainee('trainee'), field('address', 'כתובת מגורים')],
  },
  ...[2, 3].map((number) => {
    const prefix = 'trainee' + number;
    return {
      title: 'חניך נוסף ' + number,
      fields: [
        choice(prefix + 'Included', 'הוספת חניך נוסף לבקשה'),
        ...conditional(trainee(prefix), when(prefix + 'Included', 'yes')),
      ],
    };
  }),
  {
    title: 'מצב משפחתי',
    fields: [
      choice('marital', 'מצב משפחתי', {
        married: 'נשוי/אה',
        divorced: 'גרוש/ה',
        single: 'רווק/ה',
        widowed: 'אלמן/ה',
      }),
    ],
  },
  ...parents.map(({ key, title }) => ({
    title: 'פרטי ' + title,
    fields: [
      choice(key + 'Employment', 'מצב תעסוקתי', employment),
      ...conditional(
        [
          field(key + 'Name', 'שם פרטי ' + title),
          field(key + 'Id', 'תעודת זהות', 'id'),
          field(key + 'Phone', 'טלפון נייד', 'phone'),
          choice(key + 'Benefit', 'קצבה מביטוח לאומי'),
        ],
        when(key + 'Employment', 'working', 'unemployed'),
      ),
      ...conditional(
        income(key, 'שם מקום העבודה'),
        when(key + 'Employment', 'working'),
      ),
    ],
  })),
  {
    title: 'פרטים על מצב כלכלי',
    fields: [
      choice('home', 'ברשותי דירה פרטית'),
      choice('business', 'ברשותי עסק פרטי'),
      choice('vehicle', 'בבעלותי כלי רכב'),
      ...conditional(
        [
          field('vehicle1', 'סוג ושנת רכב'),
          { ...field('vehicle2', 'סוג ושנת רכב נוסף'), optional: true },
        ],
        when('vehicle', 'yes'),
      ),
      choice('municipal', 'יש ברשותי טופס הנחה שניתן מהעירייה'),
    ],
  },
  {
    title: 'קצבה מביטוח לאומי',
    fields: income('benefit', 'שם הקצבה'),
    any: parents.map(({ key }) => when(key + 'Benefit', 'yes')),
  },
  {
    title: 'נימוקים לבקשה',
    fields: [field('reasons', 'נימוקים לבקשה', 'textarea')],
  },
  { title: 'פרטי ממלא הבקשה', fields: [field('signer', 'שם ממלא הבקשה')] },
];

export const discountDeclarations = [
  'אני מצהיר בזאת כי כל הפרטים לעיל נכונים וידוע לי כי אם ימצא שהפרטים אינם נכונים או מלאים, יבוטלו ההנחות שאושרו, ואדרש לשלם את כל המגיע בתוספת הפרשי ריבית, הצמדה והוצאות.',
  'אני החתום מטה מתחייב בזאת לא לפרסם את סכום ההנחה אשר ניתנה לי. אני מצהיר בזאת כי הובא לידיעתי שבמידה ולא אעמוד בהתחייבות הנ״ל תבוטל ההנחה לאלתר.',
];

export const discountInstructions = [
  'הורים יקרים, שלום רב',
  'ועדת ההנחות של עמותת ״עת לעשות״ מטפלת בבקשות להנחה מיוחדת. הוועדה קובעת את שיעור ההנחה על פי קריטריונים אחידים, ובהתאם לתקציב הסניף.',
  'משפחה אשר מתקשה בתשלומים, ומעריכה כי היא שרויה בנסיבות מיוחדות המצדיקות סיוע, מתבקשת למלא טופס זה ולשלוח לעמותה.',
  'יש להקפיד למלא את טופס ההנחה המיוחדת בצורה ברורה ומדויקת.',
  'חובה לצרף לטופס הבקשה את כל המסמכים הנדרשים בטופס.',
  'שיעור ההנחה שייקבע תקף לכל התשלומים עבור הפעילויות והטיולים במהלך שנת הפעילות.',
  'הוועדה לא תוכל לאשר הנחה למי שלא הגיש את כל המסמכים הנדרשים.',
  'תשובה על שיעור ההנחה שנקבע תינתן על ידי מנהלי הסניפים.',
  'יש להסדיר את כל התשלומים בתחילת שנת הפעילות על מנת להבטיח השתתפות סדירה של החניך בפעילויות העמותה.',
  'עמותת ״עת לעשות״ גובה סכומים מינימליים ביותר עבור פעילות רחבה ומקיפה ועל מנת שהפעילות תוכל להמשיך ולהתקיים יש להסדיר את התשלומים בזמן.',
  'בכבוד רב, עמותת ״עת לעשות״',
];

export const discountDocuments = [
  ...parents.flatMap(({ key, title }) => [
    {
      key: key + 'IdCopy',
      label: 'צילום ספח תעודת זהות – ' + title,
      when: when(key + 'Employment', 'working', 'unemployed'),
    },
    {
      key: key + 'Unemployed',
      label: 'אישור מעמד לא עובד – ' + title,
      when: when(key + 'Employment', 'unemployed'),
    },
    {
      key: key + 'BenefitProof',
      label: 'אישור ביטוח לאומי עבור קצבה – ' + title,
      when: when(key + 'Benefit', 'yes'),
      and: when(key + 'Employment', 'working', 'unemployed'),
    },
    ...[1, 2, 3].map((month) => ({
      key: key + 'Payslip' + month,
      label: 'תלוש שכר ' + month + ' מתוך 3 החודשים האחרונים – ' + title,
      when: when(key + 'Employment', 'working'),
    })),
  ]),
  {
    key: 'municipalProof',
    label: 'טופס הנחה שניתן מהעירייה',
    when: when('municipal', 'yes'),
  },
];

export function applies(rule: Condition | undefined, data: Answers) {
  return !rule || rule.values.includes(data[rule.key]);
}

export function requiredDocuments(data: Answers) {
  return discountDocuments.filter(
    (doc) =>
      applies(doc.when, data) &&
      applies('and' in doc ? doc.and : undefined, data),
  );
}

export function validateDiscountData(
  input: unknown,
  submitting = false,
): Answers {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('פרטי הבקשה חסרים');
  }
  const allowed = new Map(
    discountSections.flatMap((section) =>
      section.fields.map((item) => [item.key, item]),
    ),
  );
  const data: Answers = {};
  for (const [key, value] of Object.entries(input)) {
    const spec = allowed.get(key);
    if (
      !spec ||
      typeof value !== 'string' ||
      value.length > (spec.kind === 'textarea' ? 3000 : 160)
    ) {
      throw new BadRequestException('פרטי הבקשה אינם תקינים');
    }
    data[key] = value.trim();
  }
  if (!submitting) return data;
  for (const { key } of parents) {
    if (data[key + 'Employment'] === 'na') delete data[key + 'Benefit'];
  }
  const result: Answers = {};
  for (const section of discountSections.filter(
    (item) => !item.any || item.any.some((rule) => applies(rule, data)),
  )) {
    for (const spec of section.fields.filter((item) =>
      applies(item.when, data),
    )) {
      const value = data[spec.key] ?? '';
      const invalid = !value
        ? !spec.optional
        : (spec.kind === 'select' &&
            !Object.hasOwn(spec.options ?? {}, value)) ||
          (spec.kind === 'id' && !/^\d{9}$/.test(value)) ||
          (spec.kind === 'phone' && !/^[+\d() -]{8,20}$/.test(value)) ||
          (spec.kind === 'money' && !/^\d{1,9}(\.\d{1,2})?$/.test(value));
      if (invalid)
        throw new BadRequestException(
          'יש למלא ערך תקין בשדה ״' + spec.label + '״ (' + section.title + ')',
        );
      if (value) result[spec.key] = value;
    }
  }
  if (parents.every(({ key }) => data[key + 'Employment'] === 'na')) {
    throw new BadRequestException('יש למלא פרטים עבור הורה אחד לפחות');
  }
  return result;
}

export function discountPdfSections(data: Answers) {
  return discountSections
    .filter(
      (section) =>
        !section.any || section.any.some((rule) => applies(rule, data)),
    )
    .map((section) => ({
      title: section.title,
      rows: section.fields
        .filter((spec) => applies(spec.when, data) && data[spec.key])
        .map((spec) => ({
          label: spec.label,
          value: spec.options?.[data[spec.key]] ?? data[spec.key],
        })),
    }))
    .filter((section) => section.rows.length);
}
