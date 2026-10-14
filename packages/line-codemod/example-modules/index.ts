import { Page, PageText } from './page';
import { Form, FieldValue } from './form';

const page = new Page();
const form = new Form();

const textResult = page
  .will()
  .checkText(new PageText('hello'))
  .and()
  .if()
  .text()
  .is()
  .equalTo(new PageText('hello'));

const fieldResult = form
  .will()
  .checkField(new FieldValue(42))
  .and()
  .if()
  .value()
  .is()
  .greaterThan(new FieldValue(10));

console.log(textResult, fieldResult);
