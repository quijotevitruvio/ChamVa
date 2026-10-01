import { describe, it, expect } from 'vitest';
import { classifyPaste, classifyDrop, choosePasteSource, dataUrlToBlob, firstImgSrc } from './paste';

const clip = (o: Partial<{ imageTypes: string[]; text: string; html: string }>) => ({
  imageTypes: [],
  text: '',
  html: '',
  ...o,
});

describe('classifyPaste', () => {
  it('imagen del portapapeles gana a todo', () => {
    expect(classifyPaste(clip({ imageTypes: ['image/png'], text: 'hola' })).kind).toBe('image');
  });
  it('texto normal -> capa de texto, normaliza saltos', () => {
    expect(classifyPaste(clip({ text: 'a\r\nb' }))).toEqual({ kind: 'text', text: 'a\nb' });
  });
  it('URL de imagen en texto -> solo texto', () => {
    expect(classifyPaste(clip({ text: 'https://x.com/a.png' })).kind).toBe('text');
  });
  it('svg como texto', () => {
    expect(classifyPaste(clip({ text: '<svg xmlns="x"><rect/></svg>' })).kind).toBe('svg');
  });
  it('img data: en html sin archivo', () => {
    const html = '<meta><img src="data:image/png;base64,AAAA" alt="">';
    expect(classifyPaste(clip({ html })).kind).toBe('data-image');
  });
  it('img http en html sin texto -> nada', () => {
    expect(classifyPaste(clip({ html: '<img src="https://x/y.png">' })).kind).toBe('none');
  });
  it('vacío', () => {
    expect(classifyPaste(clip({})).kind).toBe('none');
  });
});

describe('classifyDrop', () => {
  it('data: y blob: son legibles', () => {
    expect(classifyDrop({ uriList: 'data:image/png;base64,AA', html: '' }).kind).toBe('embedded');
    expect(classifyDrop({ uriList: 'blob:https://a/1', html: '' }).kind).toBe('embedded');
  });
  it('http(s) -> remote', () => {
    expect(classifyDrop({ uriList: '# c\nhttps://a.com/x.jpg', html: '' })).toEqual({
      kind: 'remote',
      url: 'https://a.com/x.jpg',
    });
    expect(classifyDrop({ uriList: '', html: "<img src='https://a/b.png'>" }).kind).toBe('remote');
  });
  it('nada útil', () => {
    expect(classifyDrop({ uriList: 'file:///c/a.png', html: '' }).kind).toBe('none');
  });
});

describe('choosePasteSource', () => {
  it('capa interna reciente gana', () => {
    expect(choosePasteSource({ hasInternal: true, leftAppSinceCopy: false, external: 'image' })).toBe('internal');
  });
  it('si salió de la app y hay algo externo, gana lo externo', () => {
    expect(choosePasteSource({ hasInternal: true, leftAppSinceCopy: true, external: 'text' })).toBe('external');
  });
  it('si salió pero no hay nada externo, la interna', () => {
    expect(choosePasteSource({ hasInternal: true, leftAppSinceCopy: true, external: 'none' })).toBe('internal');
  });
  it('sin interna', () => {
    expect(choosePasteSource({ hasInternal: false, leftAppSinceCopy: false, external: 'none' })).toBe('none');
    expect(choosePasteSource({ hasInternal: false, leftAppSinceCopy: false, external: 'image' })).toBe('external');
  });
});

describe('dataUrlToBlob / firstImgSrc', () => {
  it('decodifica base64', async () => {
    const b = dataUrlToBlob('data:text/plain;base64,aG9sYQ==')!;
    expect(b.type).toBe('text/plain');
    expect(await b.text()).toBe('hola');
  });
  it('rechaza basura', () => {
    expect(dataUrlToBlob('nope')).toBeNull();
  });
  it('firstImgSrc decodifica &amp;', () => {
    expect(firstImgSrc('<img src="a?x=1&amp;y=2">')).toBe('a?x=1&y=2');
  });
});
