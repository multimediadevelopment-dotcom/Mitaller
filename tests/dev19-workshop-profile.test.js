import { describe, it, expect } from 'vitest'
import {
  formatCuit,
  validateCuit,
  validatePhoneField,
  validateWorkshopProfileForm,
  validateLogoFile,
  buildBudgetWorkshopHeaderHtml
} from '../Crash_Solution_Publicacion/src/lib/workshop-profile.js'

describe('DEV-19 — Perfil Completo del Taller, Validación CUIT, Logo y Encabezado PDF', () => {
  it('formatea y valida el CUIT argentino mediante dígito verificador Módulo 11', () => {
    expect(formatCuit('30712345679')).toBe('30-71234567-9')

    const validCuit = validateCuit('30-71234567-1')
    expect(validCuit).toEqual({
      valid: true,
      formatted: '30-71234567-1',
      value: '30-71234567-1'
    })

    const invalidDigit = validateCuit('30-71234567-9')
    expect(invalidDigit.valid).toBe(false)
    expect(invalidDigit.error).toContain('dígito verificador')

    expect(validateCuit('').valid).toBe(true)
  })

  it('valida todos los campos del perfil del taller (nombre comercial, razón social, CUIT, teléfonos, email, dirección)', () => {
    const missingName = validateWorkshopProfileForm({ name: ' ' })
    expect(missingName.valid).toBe(false)

    const validProfile = validateWorkshopProfileForm({
      name: 'Crash Solution Chapa y Pintura',
      legal_name: 'Crash Solution S.R.L.',
      tax_id: '30712345671',
      phone: '011 4555-1234',
      whatsapp: '+54 9 11 5555-6789',
      email: 'Presupuestos@CrashSolution.com.ar',
      address: 'Av. Warnes 1234, CABA'
    })

    expect(validProfile.valid).toBe(true)
    expect(validProfile.values).toEqual({
      name: 'Crash Solution Chapa y Pintura',
      legal_name: 'Crash Solution S.R.L.',
      tax_id: '30-71234567-1',
      phone: '011 4555-1234',
      whatsapp: '+54 9 11 5555-6789',
      email: 'presupuestos@crashsolution.com.ar',
      address: 'Av. Warnes 1234, CABA'
    })

    expect(validatePhoneField('123').valid).toBe(false)
    expect(validatePhoneField('+54 9 11 5555-1234').valid).toBe(true)
  })

  it('valida el archivo de logo para el bucket privado workshop-logos (solo PNG, JPEG y WEBP)', () => {
    expect(validateLogoFile(null).valid).toBe(false)
    expect(validateLogoFile({ type: 'application/pdf', size: 1024 }).valid).toBe(false)
    expect(validateLogoFile({ type: 'image/svg+xml', size: 1024 }).valid).toBe(false)
    expect(validateLogoFile({ type: 'image/png', size: 6 * 1024 * 1024 }).valid).toBe(false)
    expect(validateLogoFile({ type: 'image/png', size: 150 * 1024 }).valid).toBe(true)
    expect(validateLogoFile({ type: 'image/jpeg', size: 150 * 1024 }).valid).toBe(true)
    expect(validateLogoFile({ type: 'image/webp', size: 250 * 1024 }).valid).toBe(true)
  })

  it('genera automáticamente el encabezado de presupuesto PDF con logo y todos los datos del taller', () => {
    const html = buildBudgetWorkshopHeaderHtml(
      {
        name: 'Crash Solution',
        legal_name: 'Crash Solution S.R.L.',
        tax_id: '30-71234567-1',
        logo_url: 'https://lqaedtoaukhefuibrcww.supabase.co/storage/v1/object/sign/workshop-logos/ws1/logo.png',
        address: 'Av. Warnes 1234, CABA',
        phone: '011 4555-1234',
        whatsapp: '+54 9 11 5555-6789',
        email: 'contacto@crashsolution.com.ar'
      },
      'OT-000125',
      '03/11/2026',
      '18/11/2026'
    )

    expect(html).toContain('Crash Solution')
    expect(html).toContain('Crash Solution S.R.L.')
    expect(html).toContain('CUIT: <b>30-71234567-1</b>')
    expect(html).toContain('workshop-logos/ws1/logo.png')
    expect(html).toContain('Av. Warnes 1234, CABA')
    expect(html).toContain('Tel: 011 4555-1234')
    expect(html).toContain('WhatsApp: +54 9 11 5555-6789')
    expect(html).toContain('contacto@crashsolution.com.ar')
    expect(html).toContain('OT-000125')
  })
})
